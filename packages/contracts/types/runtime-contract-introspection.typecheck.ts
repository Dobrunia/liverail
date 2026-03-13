import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands,
  defineEvents,
  event,
  inspectContractRegistry
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что публичный introspection layer сохраняет
 * точные literal-имена и typed bucket-коллекции registry без ручных generic-ов.
 * Это важно, потому что operational/debug API не должен быть типовым шагом
 * назад относительно already-typed public registry surface.
 * Также покрывается corner case с names-массивами, чтобы authoring-time слой
 * мог безопасно опираться на точные имена контрактов из introspection API.
 */
const ping = command("ping", {
  input: z.void(),
  ack: z.void()
});
const heartbeat = event("heartbeat", {
  payload: z.void()
});
const globalChannel = channel("global", {
  key: z.void()
});
const introspection = inspectContractRegistry(
  createContractRegistry({
    commands: defineCommands(ping),
    events: defineEvents(heartbeat),
    channels: defineChannels(globalChannel)
  })
);

type ShouldKeepCommandLiteralNames = Assert<
  IsEqual<typeof introspection.commands.names, readonly ["ping"]>
>;

type ShouldKeepEventLiteralLookup = Assert<
  IsEqual<typeof introspection.events.byName.heartbeat, typeof heartbeat>
>;

type ShouldKeepChannelTuple = Assert<
  IsEqual<typeof introspection.channels.list, readonly [typeof globalChannel]>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
