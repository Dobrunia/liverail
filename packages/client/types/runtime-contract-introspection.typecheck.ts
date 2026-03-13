import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что client runtime introspection возвращает
 * точные имена и typed bucket-lookup поверх registry. Это важно, потому что
 * клиентский debug/API слой должен оставаться таким же типобезопасным, как
 * основное command/subscribe/on API.
 * Также покрывается corner case с channels, чтобы не только command bucket
 * сохранял literal-типизацию в introspection surface.
 */
const ping = command("ping", {
  input: z.void(),
  ack: z.void()
});
const globalChannel = channel("global", {
  key: z.void()
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    commands: defineCommands(ping),
    channels: defineChannels(globalChannel)
  })
});
const introspection = runtime.inspectContracts();

type ShouldKeepTypedCommandNames = Assert<
  IsEqual<typeof introspection.commands.names, readonly ["ping"]>
>;

type ShouldKeepTypedChannelLookup = Assert<
  IsEqual<typeof introspection.channels.byName.global, typeof globalChannel>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
