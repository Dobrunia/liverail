import { createServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";
import { io as createSocketClient } from "socket.io-client";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  type CommandResult
} from "@dobrunia-liverail/contracts";
import {
  createClientRuntime,
  type ClientTransport
} from "../src/index.js";
import { createSocketIoClientTransport } from "../src/socket-io-entry.js";

/**
 * Проверяет на уровне типов, что Socket.IO client adapter собирается в обычный
 * `ClientTransport` и не ломает already-typed API client runtime для commands,
 * channels и inbound events.
 * Это важно, потому что transport adapter должен быть взаимозаменяемой
 * реализацией transport-контракта, а не отдельной параллельной клиентской API.
 * Также покрывается corner case с `sendCommand`, чтобы transport sender сохранял
 * официальный `CommandResult`, а не размывался до произвольного ack payload.
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
const socket = createSocketClient("http://127.0.0.1:9999", {
  autoConnect: false
});
const transport = createSocketIoClientTransport({
  socket
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    commands: [sendMessage] as const,
    channels: [voiceRoom] as const,
    events: [messageCreated] as const
  }),
  transport
});
const server = new SocketIoServer(createServer());
const pendingCommand = transport.sendCommand?.({
  name: "send-message",
  input: {
    text: "hello"
  }
});
const typedTransport: ClientTransport = transport;

type ShouldPreserveCommandResult = Assert<
  IsEqual<Awaited<typeof pendingCommand>, CommandResult | undefined>
>;

typedTransport.sendCommand;
runtime.executeCommand("send-message", {
  text: "hello"
});
runtime.subscribeChannel("voice-room", {
  roomId: "room-1"
});
runtime.onEvent("message-created", (payload) => {
  payload.text;
});

socket.close();
server.close();

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
