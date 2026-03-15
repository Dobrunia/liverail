import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands,
  defineEvents,
  event
} from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что клиентский public API сохраняет точные имена
 * contracts при построении registry через публичные helper-ы без `as const`.
 * Это важно, потому что typed client runtime должен оставаться удобным и в
 * простом happy path без ручных literal-assertion-ов в пользовательском коде.
 * Также покрывается corner case с command/channel/event API, чтобы все три
 * основные клиентские операции продолжали выводиться из одного registry shape.
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
const runtime = createClientRuntime({
  registry: createContractRegistry({
    commands: defineCommands(sendMessage),
    channels: defineChannels(voiceRoom),
    events: defineEvents(messageCreated)
  })
});

runtime.executeCommand("send-message", {
  text: "hello"
});
runtime.subscribeChannel("voice-room", {
  roomId: "room-1"
});
runtime.onEvent("message-created", (payload) => {
  payload.text;
});

runtime.executeCommand(
  // @ts-expect-error strongly typed public client API must keep exact command names
  "unknown-command",
  {
    text: "hello"
  }
);
