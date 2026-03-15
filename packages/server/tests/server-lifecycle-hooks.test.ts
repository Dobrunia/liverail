import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as RawSocketIoClient } from "socket.io-client";
import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@dobrunia-liverail/contracts";
import {
  createServerRuntime
} from "../src/index.ts";
import { createSocketIoServerAdapter } from "../src/socket-io-entry.ts";

/**
 * Проверяет, что server runtime вызывает lifecycle hooks `onJoin` и `onLeave`
 * детерминированно вокруг membership-операций и не заставляет прикручивать
 * такую логику поверх transport или command handlers. Это важно, потому что
 * presence/cleanup сценарии должны жить в официальных runtime-точках.
 * Также покрывается corner case с нормализованным channel key, чтобы hooks
 * получали уже валидированное и стабильное представление channel instance.
 */
test("should call server lifecycle hooks for join and leave operations", async () => {
  const calls: string[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const registry = createContractRegistry({
    channels: [voiceRoom] as const
  });
  const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
    registry,
    lifecycleHooks: {
      onJoin: (membership) => {
        calls.push(
          `join:${membership.name}:${membership.key.roomId}:${membership.memberId}:${membership.context.requestId}`
        );
      },
      onLeave: (execution) => {
        calls.push(
          `leave:${execution.name}:${execution.key.roomId}:${execution.memberId}`
        );
      }
    }
  });

  await runtime.joinChannel("voice-room", {
    roomId: "  room-1  "
  }, {
    memberId: "socket-1",
    context: {
      requestId: "req-1"
    }
  });
  await runtime.leaveChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "socket-1"
  });

  assert.deepEqual(calls, [
    "join:voice-room:room-1:socket-1:req-1",
    "leave:voice-room:room-1:socket-1"
  ]);
});

/**
 * Проверяет, что server lifecycle hooks `onConnect` и `onDisconnect`
 * интегрированы в реальный Socket.IO lifecycle, а не остаются абстрактными
 * коллбэками без transport wiring. Это важно, потому что presence и cleanup
 * почти всегда завязаны на реальные подключения и их закрытие.
 * Также покрывается corner case с переносом server runtime context в hook,
 * чтобы connect/disconnect точки видели тот же контекст, что и остальной runtime.
 */
test("should call server lifecycle hooks for connect and disconnect through the Socket.IO adapter", async () => {
  const calls: string[] = [];
  const harness = await createSocketIoHarness();
  const registry = createContractRegistry();
  const runtime = createServerRuntime<{ userId: string }, typeof registry>({
    registry,
    lifecycleHooks: {
      onConnect: (connection) => {
        calls.push(`connect:${connection.connectionId}:${connection.context.userId}`);
      },
      onDisconnect: (connection) => {
        calls.push(`disconnect:${connection.connectionId}:${connection.context.userId}`);
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

    const disconnected = waitForSocketEvent(socket, "disconnect");

    socket.disconnect();
    await disconnected;
    await wait(25);

    assert.deepEqual(calls, [
      `connect:${connectionId}:user-1`,
      `disconnect:${connectionId}:user-1`
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
