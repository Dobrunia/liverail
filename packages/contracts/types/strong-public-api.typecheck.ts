import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands,
  defineEvents,
  definePolicies,
  event,
  policy
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что публичные registry helper-ы сохраняют literal
 * имена контрактов и позволяют строить strongly typed registry без `as const`.
 * Это важно, потому что пользовательский код должен оставаться в официальном
 * public API surface и не опираться на ручные type-assertions ради inference.
 * Также покрывается corner case с пустыми helper-коллекциями, чтобы API
 * оставался типобезопасным и для частичных registry без лишнего шума.
 */
const sendMessage = command("send-message", {
  input: z.object({
    text: z.string()
  }),
  ack: z.object({
    saved: z.boolean()
  })
});
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string()
  })
});
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const canConnect = policy("can-connect", {
  evaluate: () => true
});
const registry = createContractRegistry({
  commands: defineCommands(sendMessage),
  events: defineEvents(messageCreated),
  channels: defineChannels(voiceRoom),
  policies: definePolicies(canConnect)
});
const emptyRegistry = createContractRegistry({
  commands: defineCommands(),
  events: defineEvents()
});

type ShouldPreserveCommandLiteralName = Assert<
  IsEqual<
    keyof typeof registry.commands.byName,
    "send-message"
  >
>;

type ShouldPreserveEventLiteralName = Assert<
  IsEqual<
    keyof typeof registry.events.byName,
    "message-created"
  >
>;

type ShouldPreserveChannelLiteralName = Assert<
  IsEqual<
    keyof typeof registry.channels.byName,
    "voice-room"
  >
>;

type ShouldPreservePolicyLiteralName = Assert<
  IsEqual<
    keyof typeof registry.policies.byName,
    "can-connect"
  >
>;

type ShouldExposeEmptyCommandBucket = Assert<
  IsEqual<typeof emptyRegistry.commands.list, readonly []>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
