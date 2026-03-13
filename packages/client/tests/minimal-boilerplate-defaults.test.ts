import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  command,
  createContractRegistry
} from "@liverail/contracts";
import {
  createServerRuntime,
  createSocketIoServerAdapter
} from "@liverail/server";
import {
  createClientRuntime,
  createSocketIoClientTransport
} from "../src/index.ts";

/**
 * Проверяет, что клиентский Socket.IO adapter умеет строиться напрямую
 * из `url` и стандартных socket options без ручного создания socket
 * экземпляра в пользовательском коде. Это важно, потому что это самый
 * частый happy path интеграции и именно он должен быть самым коротким.
 * Также покрывается corner case с `destroy`, чтобы transport корректно
 * освобождал внутренний socket, который он создал сам по default-path.
 */
test("should create a Socket.IO client transport from url for the common happy path", async () => {
  const harness = await createSocketIoHarness();
  const ping = command("ping", {
    input: z.object({
      roomId: z.string().min(1)
    }),
    ack: z.object({
      ok: z.literal(true)
    })
  });
  const registry = createContractRegistry({
    commands: [ping] as const
  });
  const runtime = createServerRuntime({
    registry,
    commandHandlers: {
      ping: () => ({
        ok: true as const
      })
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return undefined;
    }
  });

  const clientRuntime = createClientRuntime({
    registry,
    transport: createSocketIoClientTransport({
      url: harness.url,
      socketOptions: {
        forceNew: true,
        reconnection: false,
        transports: ["websocket"]
      }
    })
  });
  let isDestroyed = false;

  try {
    const ack = await clientRuntime.executeCommand("ping", {
      roomId: "room-1"
    }, {
      timeoutMs: 250
    });

    assert.deepEqual(ack, {
      ok: true
    });

    clientRuntime.destroy();
    isDestroyed = true;

    await waitFor(() => harness.io.of("/").sockets.size === 0);
  } finally {
    if (!isDestroyed) {
      clientRuntime.destroy();
    }

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

function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const intervalId = setInterval(() => {
      if (predicate()) {
        clearInterval(intervalId);
        resolve();
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(intervalId);
        reject(new Error("Timed out while waiting for the expected condition."));
      }
    }, 10);
  });
}
