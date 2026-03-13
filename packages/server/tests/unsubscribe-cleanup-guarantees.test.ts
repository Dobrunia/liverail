import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as RawSocketIoClient } from "socket.io-client";
import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@liverail/contracts";
import {
  createServerRuntime
} from "../src/index.ts";
import {
  createSocketIoServerAdapter,
  SOCKET_IO_CHANNEL_JOIN_EVENT
} from "../src/socket-io-entry.ts";

/**
 * Проверяет, что dispose у Socket.IO adapter не бросает только локальные
 * listeners, а действительно инициирует cleanup серверных runtime-ресурсов:
 * channel membership и lifecycle hooks подключенных сокетов.
 * Это важно, потому что остановка adapter-а должна быть надежной точкой
 * освобождения ресурсов, а не оставлять зависшие membership на сервере.
 * Также покрывается corner case с активным join, чтобы dispose снимал и
 * room membership, и disconnect/leave hooks для уже подключенного клиента.
 */
test("should cleanup server memberships and lifecycle hooks when the Socket.IO adapter is disposed", async () => {
  const calls: string[] = [];
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    lifecycleHooks: {
      onLeave: (execution) => {
        calls.push(`leave:${execution.name}:${execution.memberId}`);
      },
      onDisconnect: (connection) => {
        calls.push(`disconnect:${connection.connectionId}:${connection.context.userId}`);
      }
    }
  });
  const adapter = createSocketIoServerAdapter({
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

  try {
    await waitForSocketEvent(socket, "connect");

    await emitWithAck(socket, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: " room-1 "
      }
    });
    const connectionId = socket.id;

    assert.equal(runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }).length, 1);

    adapter.dispose();
    await wait(25);

    assert.deepEqual(runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }), []);
    assert.deepEqual(calls, [
      `leave:voice-room:${connectionId}`,
      `disconnect:${connectionId}:user-1`
    ]);
  } finally {
    socket.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что disconnect-cleanup не обрывается после первой ошибки leave
 * hook-а и продолжает снимать остальные memberships того же подключения.
 * Это важно, потому что cleanup guarantees должны быть устойчивыми к частичным
 * сбоям и не оставлять зависшие server-side memberships только потому, что
 * один lifecycle hook завершился ошибкой. Также покрывается corner case с
 * несколькими room membership одного сокета, чтобы cleanup проходил по всем
 * каналам, а `onDisconnect` вызывался даже после сбоя одного `onLeave`.
 */
test("should cleanup all server memberships on disconnect even if one leave hook fails", async () => {
  const leaveCalls: string[] = [];
  const disconnectCalls: string[] = [];
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    lifecycleHooks: {
      onLeave: (execution) => {
        const key = execution.key as { roomId: string };

        leaveCalls.push(key.roomId);

        if (key.roomId === "room-1") {
          throw new Error("Presence cleanup failed for room-1.");
        }
      },
      onDisconnect: (connection) => {
        disconnectCalls.push(`${connection.connectionId}:${connection.context.userId}`);
      }
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

  try {
    await waitForSocketEvent(socket, "connect");
    const connectionId = socket.id;

    await emitWithAck(socket, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: " room-1 "
      }
    });
    await emitWithAck(socket, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: " room-2 "
      }
    });

    const disconnected = waitForSocketEvent(socket, "disconnect");

    socket.disconnect();
    await disconnected;
    await wait(50);

    assert.deepEqual(runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }), []);
    assert.deepEqual(runtime.listChannelMembers("voice-room", {
      roomId: "room-2"
    }), []);
    assert.deepEqual(leaveCalls.sort(), ["room-1", "room-2"]);
    assert.deepEqual(disconnectCalls, [
      `${connectionId}:user-1`
    ]);
  } finally {
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

function emitWithAck<TResult>(
  socket: RawSocketIoClient,
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
