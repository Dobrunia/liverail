import { io as createSocketClient, type Socket as RawSocketIoClient } from "socket.io-client";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  type ClientRuntime
} from "dobrunia-liverail-client";
import { createSocketIoClientTransport } from "dobrunia-liverail-client/socket-io";
import {
  createServerRuntime,
  type ServerRuntime
} from "dobrunia-liverail-server";
import {
  createSocketIoChannelRoute,
  createSocketIoEventDeliverer,
  createSocketIoServerAdapter,
  type SocketIoServerAdapter
} from "dobrunia-liverail-server/socket-io";
import type { Server as SocketIoServer } from "socket.io";

/**
 * Минимальный набор contracts для example-app.
 * Нужен как consumer-level пример поверх публичных entrypoints библиотечных пакетов.
 */
export const sendMessage = command("send-message", {
  input: z.object({
    roomId: z.string().trim().min(1),
    text: z.string().trim().min(1)
  }),
  ack: z.object({
    saved: z.literal(true)
  })
});

/**
 * Демонстрационный channel contract комнаты чата.
 */
export const chatRoom = channel("chat-room", {
  key: z.object({
    roomId: z.string().trim().min(1)
  })
});

/**
 * Демонстрационное событие новых сообщений комнаты.
 */
export const messageCreated = event("message-created", {
  payload: z.object({
    roomId: z.string().trim().min(1),
    text: z.string().trim().min(1)
  })
});

/**
 * Общий registry example-app.
 */
export const exampleRegistry = createContractRegistry({
  commands: [sendMessage] as const,
  channels: [chatRoom] as const,
  events: [messageCreated] as const
});

/**
 * Собранный server-side example runtime и его transport adapter.
 */
export interface ExampleChatServer {
  /**
   * Server runtime example-приложения.
   */
  readonly runtime: ServerRuntime<{ userId: string }, typeof exampleRegistry>;

  /**
   * Socket.IO adapter example-приложения.
   */
  readonly adapter: SocketIoServerAdapter;

  /**
   * Публичный helper для эмиссии сообщения в комнату.
   */
  readonly emitRoomMessage: (
    roomId: string,
    text: string
  ) => Promise<void>;
}

/**
 * Создает минимальный chat-like server example поверх публичного LiveRail API.
 */
export function createExampleChatServer(io: SocketIoServer): ExampleChatServer {
  const runtime = createServerRuntime<{ userId: string }, typeof exampleRegistry>({
    registry: exampleRegistry,
    commandHandlers: {
      "send-message": () => ({
        saved: true as const
      })
    },
    eventRouters: {
      "message-created": ({ payload }) => createSocketIoChannelRoute("chat-room", {
        roomId: payload.roomId
      })
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(io)
    }
  });
  const adapter = createSocketIoServerAdapter({
    io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId ?? "guest")
      };
    }
  });

  return Object.freeze({
    runtime,
    adapter,
    async emitRoomMessage(roomId: string, text: string) {
      await runtime.emitEvent("message-created", {
        roomId,
        text
      }, {
        context: {
          userId: "server"
        }
      });
    }
  });
}

/**
 * Собранный client-side example runtime и связанный Socket.IO socket.
 */
export interface ExampleChatClient {
  /**
   * Client runtime example-приложения.
   */
  readonly runtime: ClientRuntime<typeof exampleRegistry>;

  /**
   * Реальный Socket.IO client socket example-приложения.
   */
  readonly socket: RawSocketIoClient;

  /**
   * Освобождает runtime и transport ресурсы example-клиента.
   */
  readonly destroy: () => void;
}

/**
 * Создает минимальный chat-like client example поверх публичного LiveRail API.
 */
export function createExampleChatClient(
  url: string,
  userId: string
): ExampleChatClient {
  const socket = createSocketClient(url, {
    auth: {
      userId
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const runtime = createClientRuntime({
    registry: exampleRegistry,
    transport: createSocketIoClientTransport({
      socket
    })
  });

  return Object.freeze({
    runtime,
    socket,
    destroy() {
      runtime.destroy();
      socket.disconnect();
    }
  });
}
