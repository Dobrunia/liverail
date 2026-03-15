import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  policy,
  type ChannelContract,
  type CommandContract,
  type EventContract,
  type PolicyContract
} from "dobrunia-liverail-contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что runtime core сохраняет точные literal-имена
 * зарегистрированных contracts и возвращает их из resolve-методов без ручных cast-ов.
 * Это важно, потому что дальнейшие server pipeline-слои должны строиться
 * поверх typed runtime lookup, а не терять информацию о конкретном контракте.
 * Также покрывается corner case с неизвестным строковым именем, чтобы fallback
 * тип оставался безопасным и не притворялся конкретным зарегистрированным contract.
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
const canConnect = policy("can-connect", {
  evaluate: () => true
});
const runtime = createServerRuntime({
  registry: createContractRegistry({
    commands: [ping] as const,
    events: [heartbeat] as const,
    channels: [globalChannel] as const,
    policies: [canConnect] as const
  })
});

const resolvedPing = runtime.resolveCommand("ping");
const resolvedHeartbeat = runtime.resolveEvent("heartbeat");
const resolvedGlobalChannel = runtime.resolveChannel("global");
const resolvedCanConnect = runtime.resolvePolicy("can-connect");
const unknownCommand = runtime.resolveCommand("unknown-command" as string);

type ShouldResolveRegisteredContractsPrecisely = Assert<
  IsEqual<typeof resolvedPing, typeof ping> &
    IsEqual<typeof resolvedHeartbeat, typeof heartbeat> &
    IsEqual<typeof resolvedGlobalChannel, typeof globalChannel> &
    IsEqual<typeof resolvedCanConnect, typeof canConnect> &
    IsEqual<typeof unknownCommand, CommandContract | undefined>
>;

type ShouldKeepRuntimeRegistryShape = Assert<
  IsEqual<typeof runtime.registry.commands.byName.ping, typeof ping> &
    IsEqual<typeof runtime.registry.events.byName.heartbeat, typeof heartbeat> &
    IsEqual<
      typeof runtime.registry.channels.byName.global,
      typeof globalChannel
    > &
    IsEqual<
      typeof runtime.registry.policies.byName["can-connect"],
      typeof canConnect
    >
>;

type ShouldExposeBaseContractFallbacks = Assert<
  IsEqual<ReturnType<typeof runtime.resolveCommand>, CommandContract | undefined> &
    IsEqual<ReturnType<typeof runtime.resolveEvent>, EventContract | undefined> &
    IsEqual<
      ReturnType<typeof runtime.resolveChannel>,
      ChannelContract | undefined
    > &
    IsEqual<ReturnType<typeof runtime.resolvePolicy>, PolicyContract | undefined>
>;

z;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
