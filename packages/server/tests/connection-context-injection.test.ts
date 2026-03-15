import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as RawSocketIoClient } from "socket.io-client";
import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  connectPolicy,
  createContractRegistry
} from "dobrunia-liverail-contracts";
import {
  createServerRuntime,
  type ServerRuntimeContext
} from "../src/index.ts";
import {
  createSocketIoServerAdapter,
  SOCKET_IO_CHANNEL_JOIN_EVENT,
  SOCKET_IO_COMMAND_EVENT
} from "../src/socket-io-entry.ts";

/**
 * Проверяет, что transport layer может единообразно собрать connection/session
 * context и дальше прокинуть один и тот же shape в connect policy, command handler
 * и join authorizer без прямой зависимости этих слоев от Socket.IO API.
 * Это важно, потому что transport integration должна нормализовать контекст один раз,
 * а не заставлять каждый policy/handler вручную читать handshake/socket-поля.
 * Также покрывается corner case с membership context, чтобы после join тот же
 * унифицированный context сохранялся и в channel runtime, а не создавался заново иначе.
 */
test("should inject a unified runtime context into connection policies handlers and channel joins", async () => {
  const harness = await createSocketIoHarness();
  const inspectContext = command("inspect-context", {
    input: z.void(),
    ack: z.object({
      connectionId: z.string().min(1),
      transport: z.literal("socket.io"),
      tenantId: z.string().min(1),
      userId: z.string().min(1),
      ip: z.string().min(1)
    })
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  let connectPolicyCalled = false;
  const runtime = createServerRuntime<
    ServerRuntimeContext<
      { tenantId: string },
      { id: string },
      { ip: string },
      "socket.io"
    >
  >({
    registry: createContractRegistry({
      commands: [inspectContext] as const,
      channels: [voiceRoom] as const
    }),
    connectionPolicies: [
      connectPolicy("requires-unified-context", {
        evaluate({ context }) {
          connectPolicyCalled = true;

          return (
            context.connection.transport === "socket.io" &&
            context.session.tenantId.length > 0 &&
            context.user.id.length > 0 &&
            context.metadata.ip.length > 0
          );
        }
      })
    ],
    commandHandlers: {
      "inspect-context": ({ context }) => ({
        connectionId: context.connection.id,
        transport: context.connection.transport,
        tenantId: context.session.tenantId,
        userId: context.user.id,
        ip: context.metadata.ip
      })
    },
    channelJoinAuthorizers: {
      "voice-room": ({ context }) =>
        context.connection.transport === "socket.io" &&
        context.metadata.ip.length > 0
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    injectContext(socket) {
      return {
        session: {
          tenantId: String(socket.handshake.auth.tenantId)
        },
        user: {
          id: String(socket.handshake.auth.userId)
        },
        metadata: {
          ip: String(socket.handshake.address)
        }
      };
    }
  });

  const client = createSocketClient(harness.url, {
    auth: {
      tenantId: "tenant-1",
      userId: "user-1"
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");

    const commandResult = await emitWithAck<{
      readonly status: "ack";
      readonly ack: {
        readonly connectionId: string;
        readonly transport: "socket.io";
        readonly tenantId: string;
        readonly userId: string;
        readonly ip: string;
      };
    }>(client, SOCKET_IO_COMMAND_EVENT, {
      name: "inspect-context",
      input: undefined
    });
    const joinResult = await emitWithAck<{
      readonly ok: true;
    }>(client, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    const members = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });

    assert.equal(connectPolicyCalled, true);
    assert.equal(commandResult.status, "ack");
    assert.equal(commandResult.ack.connectionId, client.id);
    assert.equal(commandResult.ack.transport, "socket.io");
    assert.equal(commandResult.ack.tenantId, "tenant-1");
    assert.equal(commandResult.ack.userId, "user-1");
    assert.equal(commandResult.ack.ip.includes("127.0.0.1"), true);
    assert.deepEqual(joinResult, {
      ok: true
    });
    assert.equal(members.length, 1);
    assert.equal(members[0]?.context.connection.id, client.id);
    assert.equal(members[0]?.context.connection.transport, "socket.io");
    assert.equal(members[0]?.context.session.tenantId, "tenant-1");
    assert.equal(members[0]?.context.user.id, "user-1");
    assert.equal(
      members[0]?.context.metadata.ip.includes("127.0.0.1"),
      true
    );
  } finally {
    client.disconnect();
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
