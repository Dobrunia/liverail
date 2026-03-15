import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";
import { test } from "vitest";

import {
  createExampleChatClient,
  createExampleChatServer
} from "../src/chat-example.ts";

/**
 * Проверяет, что example-app действительно собирается как consumer layer
 * поверх публичных entrypoints `@dobrunia-liverail/contracts`, `@dobrunia-liverail/server`,
 * `@dobrunia-liverail/server/socket-io`, `@dobrunia-liverail/client` и `@dobrunia-liverail/client/socket-io`,
 * а не опирается на внутренние файлы или тестовые helper-ы пакетов.
 * Это важно, потому что предыдущее ревью явно указывало на отсутствие
 * отдельного integration/example слоя и ограниченность уверенности только
 * package-level тестами. Также покрывается corner case со связкой command +
 * subscribe + event delivery, чтобы example-app доказывал не только импорт
 * API, но и реальный end-to-end roundtrip через Socket.IO transport.
 */
test("should assemble a working chat flow through the example app and public package entrypoints", async () => {
  const harness = await createSocketIoHarness();
  const server = createExampleChatServer(harness.io);
  const client = createExampleChatClient(harness.url, "user-1");
  let receivedPayload:
    | {
        roomId: string;
        text: string;
      }
    | undefined;

  client.runtime.onEvent("message-created", (payload) => {
    receivedPayload = payload;
  });

  try {
    await waitForSocketEvent(client.socket, "connect");

    const ack = await client.runtime.executeCommand("send-message", {
      roomId: "room-1",
      text: "hello"
    });

    await client.runtime.subscribeChannel("chat-room", {
      roomId: "room-1"
    });
    await server.emitRoomMessage("room-1", "server-message");
    await wait(50);

    assert.deepEqual(ack, {
      saved: true
    });
    assert.deepEqual(receivedPayload, {
      roomId: "room-1",
      text: "server-message"
    });
  } finally {
    client.destroy();
    server.adapter.dispose();
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
  socket: {
    once: (eventName: string, listener: (payload: TPayload) => void) => void;
  },
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
