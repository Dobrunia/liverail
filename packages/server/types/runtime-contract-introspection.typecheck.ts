import { z } from "zod";

import {
  command,
  createContractRegistry,
  defineCommands
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что server runtime introspection сохраняет
 * точные literal-имена зарегистрированных контрактов и не деградирует до
 * безымянных string-массивов. Это важно, потому что debug/public API должен
 * оставаться согласованным с уже типизированным registry surface.
 * Также покрывается corner case с byName lookup, чтобы tooling-слой мог
 * безопасно получать typed contract прямо из runtime introspection.
 */
const ping = command("ping", {
  input: z.void(),
  ack: z.void()
});
const runtime = createServerRuntime({
  registry: createContractRegistry({
    commands: defineCommands(ping)
  })
});
const introspection = runtime.inspectContracts();

type ShouldKeepTypedCommandNames = Assert<
  IsEqual<typeof introspection.commands.names, readonly ["ping"]>
>;

type ShouldKeepTypedCommandLookup = Assert<
  IsEqual<typeof introspection.commands.byName.ping, typeof ping>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
