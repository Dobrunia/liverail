import { createServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "@liverail/contracts";
import {
  createServerRuntime,
  type ServerEventRoute,
  type ServerEventDeliverer
} from "../src/index.js";
import {
  createSocketIoChannelRoute,
  createSocketIoEventDeliverer,
  createSocketIoServerAdapter,
  createSocketIoSocketRoute
} from "../src/socket-io-entry.js";

/**
 * Проверяет на уровне типов, что Socket.IO server adapter принимает уже
 * существующий typed server runtime и не размывает его до строкового API.
 * Это важно, потому что transport-интеграция должна надстраиваться над
 * runtime-контрактами, а не отменять уже выведенные типы commands/events.
 * Также покрывается corner case с route helper-ами и deliverer-ом, чтобы
 * outbound event delivery оставался совместим с общим server event pipeline.
 */
const sendMessage = command("send-message", {
  input: z.object({
    text: z.string()
  }),
  ack: z.object({
    saved: z.boolean()
  })
});
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string()
  })
});
const io = new SocketIoServer(createServer());
const runtime = createServerRuntime({
  registry: createContractRegistry({
    commands: [sendMessage] as const,
    channels: [voiceRoom] as const,
    events: [messageCreated] as const
  }),
  commandHandlers: {
    "send-message": () => ({
      saved: true
    })
  }
});
const adapter = createSocketIoServerAdapter({
  io,
  runtime,
  resolveContext(socket) {
    return {
      userId: String(socket.handshake.auth.userId ?? "")
    };
  }
});
const directRoute: ServerEventRoute = createSocketIoSocketRoute("socket-1");
const channelRoute: ServerEventRoute = createSocketIoChannelRoute("voice-room", {
  roomId: "room-1"
});
const eventDeliverer: ServerEventDeliverer<typeof messageCreated, { userId: string }> =
  createSocketIoEventDeliverer(io);

adapter.commandEvent;
adapter.joinEvent;
adapter.leaveEvent;
directRoute.target;
channelRoute.target;
eventDeliverer;

type ShouldExposeDispose = Assert<
  IsEqual<typeof adapter.dispose, () => void>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
