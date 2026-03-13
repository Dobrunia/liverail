import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as ClientSocket } from "socket.io-client";
import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  connectPolicy,
  createContractRegistry,
  event
} from "@liverail/contracts";
import {
  createServerRuntime
} from "../src/index.ts";
import {
  createSocketIoChannelRoute,
  createSocketIoEventDeliverer,
  createSocketIoServerAdapter,
  createSocketIoSocketRoute,
  SOCKET_IO_CHANNEL_JOIN_EVENT,
  SOCKET_IO_CHANNEL_LEAVE_EVENT,
  SOCKET_IO_COMMAND_EVENT
} from "../src/socket-io-entry.ts";

/**
 * Проверяет, что Socket.IO server adapter остается тонким transport-слоем:
 * он только принимает transport-события, строит context, вызывает готовый
 * server runtime и отдает обратно transport-friendly результаты.
 * Это важно, потому что core command/join/leave логика уже живет в runtime и
 * не должна дублироваться или разъезжаться внутри transport-интеграции.
 * Также покрываются corner cases с join и leave, чтобы adapter одинаково
 * связывал runtime membership и реальные Socket.IO rooms на одном socket.
 */
test("should execute commands and channel membership through the Socket.IO server adapter", async () => {
  const harness = await createSocketIoHarness();
  const sendMessage = command("send-message", {
    input: z.object({
      text: z.string().trim().min(1)
    }),
    ack: z.object({
      saved: z.literal(true),
      userId: z.string()
    })
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      commands: [sendMessage] as const,
      channels: [voiceRoom] as const
    }),
    commandHandlers: {
      "send-message": ({ context }) => ({
        saved: true as const,
        userId: context.userId
      })
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId)
      };
    }
  });

  const client = createSocketClient(harness.url, {
    auth: {
      userId: "user-1"
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");

    const commandResult = await emitWithAck(client, SOCKET_IO_COMMAND_EVENT, {
      name: "send-message",
      input: {
        text: "  hello  "
      }
    });

    const joinResult = await emitWithAck(client, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    const membersAfterJoin = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });
    const leaveResult = await emitWithAck(client, SOCKET_IO_CHANNEL_LEAVE_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    const membersAfterLeave = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });

    assert.deepEqual(commandResult, {
      status: "ack",
      ack: {
        saved: true,
        userId: "user-1"
      }
    });
    assert.deepEqual(joinResult, {
      ok: true
    });
    assert.equal(membersAfterJoin.length, 1);
    assert.equal(membersAfterJoin[0]?.memberId, client.id);
    assert.deepEqual(membersAfterJoin[0]?.context, {
      userId: "user-1"
    });
    assert.deepEqual(leaveResult, {
      ok: true
    });
    assert.deepEqual(membersAfterLeave, []);
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что connection policy runtime не теряется внутри Socket.IO
 * middleware и до клиента доходит официальный `connection-denied`, а не сырой
 * transport-specific отказ или внутреннее исключение Socket.IO.
 * Это важно, потому что transport adapter не должен вводить собственную модель
 * connect-ошибок поверх уже существующего unified realtime error model.
 * Также покрывается corner case с auth-less подключением, чтобы adapter умел
 * отклонять session еще на handshake-этапе через стандартный `connect_error`.
 */
test("should reject denied Socket.IO connections with the unified realtime error model", async () => {
  const harness = await createSocketIoHarness();
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({}),
    connectionPolicies: [
      connectPolicy("requires-user", {
        evaluate({ context }) {
          return context.userId.length > 0 || {
            allowed: false as const,
            code: "connection-denied" as const,
            message: "Authentication is required."
          };
        }
      })
    ]
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId ?? "")
      };
    }
  });

  const client = createSocketClient(harness.url, {
    auth: {},
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    const error = await waitForSocketEvent<Error & {
      data?: {
        code?: string;
        message?: string;
      };
    }>(client, "connect_error");

    assert.equal(error.message, "Authentication is required.");
    assert.deepEqual(error.data, {
      code: "connection-denied",
      message: "Authentication is required.",
      name: "LiveRailRealtimeError"
    });
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что Socket.IO adapter доставляет server events и в конкретный
 * socket, и в channel room, используя один и тот же transport-specific
 * deliverer без дублирования бизнес-логики в event pipeline.
 * Это важно, потому что transport layer должен лишь материализовать route,
 * а вся маршрутизация по contracts должна продолжать жить в server runtime.
 * Также покрывается corner case с нетаргетированным клиентом, чтобы adapter
 * не рассылал событие шире, чем указано в socket и channel route helpers.
 */
test("should deliver runtime events to Socket.IO sockets and channel rooms", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  let directTargetSocketId = "";
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [messageCreated] as const
    }),
    eventRouters: {
      "message-created": () => [
        createSocketIoChannelRoute("voice-room", {
          roomId: "room-1"
        }),
        createSocketIoSocketRoute(directTargetSocketId)
      ]
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(harness.io)
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {
        userId: "server-test"
      };
    }
  });

  const roomClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const directClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const ignoredClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await Promise.all([
      waitForSocketEvent(roomClient, "connect"),
      waitForSocketEvent(directClient, "connect"),
      waitForSocketEvent(ignoredClient, "connect")
    ]);
    directTargetSocketId = directClient.id ?? "";

    const roomEvent = waitForSocketEvent<{ text: string }>(
      roomClient,
      "message-created"
    );
    const directEvent = waitForSocketEvent<{ text: string }>(
      directClient,
      "message-created"
    );
    let ignoredReceived = false;

    ignoredClient.once("message-created", () => {
      ignoredReceived = true;
    });

    await emitWithAck(roomClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    const deliveries = await runtime.emitEvent("message-created", {
      text: "hello"
    }, {
      context: {
        userId: "server-test"
      }
    });

    assert.equal(deliveries.length, 2);
    assert.deepEqual(await roomEvent, {
      text: "hello"
    });
    assert.deepEqual(await directEvent, {
      text: "hello"
    });

    await wait(50);

    assert.equal(ignoredReceived, false);
  } finally {
    roomClient.disconnect();
    directClient.disconnect();
    ignoredClient.disconnect();
    await harness.close();
  }
});

interface SocketIoHarness {
  readonly io: SocketIoServer;
  readonly url: string;
  readonly close: () => Promise<void>;
}

async function createSocketIoHarness(): Promise<SocketIoHarness> {
  const httpServer = createServer();
  const io = new SocketIoServer(httpServer, {
    serveClient: false
  });

  await listenHttpServer(httpServer);

  const address = httpServer.address();

  if (address === null || typeof address === "string") {
    throw new TypeError("Socket.IO test server did not expose a numeric port.");
  }

  return {
    io,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await closeSocketIoServer(io);
    }
  };
}

function listenHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeSocketIoServer(server: SocketIoServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function emitWithAck<TResult>(
  socket: ClientSocket,
  eventName: string,
  payload: unknown
): Promise<TResult> {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, (result: TResult) => {
      resolve(result);
    });
  });
}

function waitForSocketEvent<TPayload = void>(
  socket: ClientSocket,
  eventName: string,
  timeoutMs = 1_000
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while waiting for Socket.IO event: ${eventName}.`));
    }, timeoutMs);

    socket.once(eventName, (payload: TPayload) => {
      clearTimeout(timeoutId);
      resolve(payload);
    });
  });
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
