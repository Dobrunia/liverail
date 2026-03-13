import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as RawSocketIoClient } from "socket.io-client";
import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  createRealtimeError,
  event,
  isRealtimeError
} from "@liverail/contracts";
import {
  createServerRuntime,
  createSocketIoChannelRoute,
  createSocketIoEventDeliverer,
  createSocketIoServerAdapter,
  SOCKET_IO_COMMAND_EVENT
} from "@liverail/server";
import {
  createClientRuntime,
  createSocketIoClientTransport
} from "../src/index.ts";

/**
 * Проверяет, что Socket.IO client adapter реально подключает client runtime к
 * боевому transport: команды уходят через ack-механику, channel subscribe
 * вызывает join на сервере, а inbound events приходят обратно в typed listener.
 * Это важно, потому что adapter обязан использовать уже существующий runtime
 * API, а не обходить его сырыми socket-вызовами из пользовательского кода.
 * Также покрывается corner case с realtime-ошибкой команды, чтобы serialized
 * server error восстанавливался на клиенте без потери unified error model.
 */
test("should execute commands receive events and restore realtime errors through the Socket.IO client adapter", async () => {
  const harness = await createSocketIoHarness();
  const sendMessage = command("send-message", {
    input: z.object({
      text: z.string().trim().min(1)
    }),
    ack: z.object({
      saved: z.literal(true)
    })
  });
  const deleteMessage = command("delete-message", {
    input: z.object({
      messageId: z.string().min(1)
    }),
    ack: z.void()
  });
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
  const registry = createContractRegistry({
    commands: [sendMessage, deleteMessage] as const,
    channels: [voiceRoom] as const,
    events: [messageCreated] as const
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry,
    commandHandlers: {
      "send-message": () => ({
        saved: true as const
      }),
      "delete-message": () => {
        throw createRealtimeError({
          code: "forbidden",
          message: "Only moderators can delete messages."
        });
      }
    },
    eventRouters: {
      "message-created": () => createSocketIoChannelRoute("voice-room", {
        roomId: "room-1"
      })
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
        userId: "user-1"
      };
    }
  });

  const socket = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const clientRuntime = createClientRuntime({
    registry,
    transport: createSocketIoClientTransport({
      socket
    })
  });
  let receivedPayload: { text: string } | undefined;

  clientRuntime.onEvent("message-created", (payload) => {
    receivedPayload = payload;
  });

  try {
    await waitForSocketEvent(socket, "connect");

    const ack = await clientRuntime.executeCommand("send-message", {
      text: "  hello  "
    }, {
      timeoutMs: 250
    });

    await clientRuntime.subscribeChannel("voice-room", {
      roomId: "room-1"
    });
    await runtime.emitEvent("message-created", {
      text: "server-event"
    }, {
      context: {
        userId: "user-1"
      }
    });
    await wait(50);

    await assert.rejects(
      () =>
        clientRuntime.executeCommand("delete-message", {
          messageId: "message-1"
        }),
      (error: unknown) => {
        if (!isRealtimeError(error)) {
          return false;
        }

        assert.equal(error.code, "forbidden");
        assert.equal(error.message, "Only moderators can delete messages.");
        return true;
      }
    );

    assert.deepEqual(ack, {
      saved: true
    });
    assert.deepEqual(receivedPayload, {
      text: "server-event"
    });
  } finally {
    clientRuntime.destroy();
    socket.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что Socket.IO client adapter корректно кормит существующую модель
 * connection lifecycle и не ломает reconnect-safe resubscription внутри client runtime.
 * Это важно, потому что reconnect-логика уже централизована в runtime и transport
 * должен только честно отдавать `connected`/`disconnected`, не изобретая свою модель.
 * Также покрывается corner case с очисткой старого membership на сервере, чтобы
 * после reconnect не оставались висячие участники и channel room восстанавливался один раз.
 */
test("should restore channel subscriptions after Socket.IO reconnect", async () => {
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
  const registry = createContractRegistry({
    channels: [voiceRoom] as const,
    events: [messageCreated] as const
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry,
    eventRouters: {
      "message-created": () => createSocketIoChannelRoute("voice-room", {
        roomId: "room-1"
      })
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
        userId: "user-1"
      };
    }
  });

  const socket = createSocketClient(harness.url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const clientRuntime = createClientRuntime({
    registry,
    transport: createSocketIoClientTransport({
      socket
    })
  });
  let receivedPayload: { text: string } | undefined;

  clientRuntime.onEvent("message-created", (payload) => {
    receivedPayload = payload;
  });

  try {
    socket.connect();
    await waitForSocketEvent(socket, "connect");

    await clientRuntime.subscribeChannel("voice-room", {
      roomId: "room-1"
    });

    const disconnected = waitForSocketEvent(socket, "disconnect");

    socket.disconnect();
    await disconnected;

    socket.connect();
    await waitForSocketEvent(socket, "connect");
    await wait(50);

    const members = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });

    await runtime.emitEvent("message-created", {
      text: "after-reconnect"
    }, {
      context: {
        userId: "user-1"
      }
    });
    await wait(50);

    assert.equal(members.length, 1);
    assert.equal(members[0]?.memberId, socket.id);
    assert.deepEqual(receivedPayload, {
      text: "after-reconnect"
    });
  } finally {
    clientRuntime.destroy();
    socket.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что Socket.IO client adapter не ломает уже существующую timeout model:
 * если сервер не прислал ack, именно client runtime должен завершить ожидание по timeout.
 * Это важно, потому что адаптер не должен изобретать свою таймерную семантику поверх
 * текущего command API и обязан оставаться совместимым с per-call timeout option.
 * Также покрывается corner case с полным отсутствием ack callback, чтобы adapter
 * не подменял этот сценарий ложным `missing-ack` и не скрывал реальное ожидание.
 */
test("should preserve the existing timeout model when Socket.IO command ack is missing", async () => {
  const harness = await createSocketIoHarness();
  const sendMessage = command("send-message", {
    input: z.object({
      text: z.string()
    }),
    ack: z.object({
      saved: z.boolean()
    })
  });
  const registry = createContractRegistry({
    commands: [sendMessage] as const
  });

  harness.io.on("connection", (socket) => {
    socket.on(SOCKET_IO_COMMAND_EVENT, () => {
      return undefined;
    });
  });

  const socket = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const clientRuntime = createClientRuntime({
    registry,
    transport: createSocketIoClientTransport({
      socket
    })
  });

  try {
    await waitForSocketEvent(socket, "connect");

    await assert.rejects(
      () =>
        clientRuntime.executeCommand("send-message", {
          text: "hello"
        }, {
          timeoutMs: 50
        }),
      (error: unknown) => {
        if (!isRealtimeError(error)) {
          return false;
        }

        assert.equal(error.code, "timeout");
        return true;
      }
    );
  } finally {
    clientRuntime.destroy();
    socket.disconnect();
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

function waitForSocketEvent<TPayload = void>(
  socket: RawSocketIoClient,
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
