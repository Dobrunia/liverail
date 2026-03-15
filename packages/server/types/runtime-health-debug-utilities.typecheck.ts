import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что server debug snapshot сохраняет typed names
 * и активные channel entries поверх текущего runtime API. Это важно, потому
 * что debug/public utilities не должны ломать already-typed contract surface.
 * Также покрывается corner case с active channel list, чтобы debug-слой
 * сохранял типизированный доступ хотя бы к contract и name канала.
 */
const ping = command("ping", {
  input: z.void(),
  ack: z.void()
});
const globalChannel = channel("global", {
  key: z.object({
    roomId: z.string()
  })
});
const runtime = createServerRuntime({
  registry: createContractRegistry({
    commands: defineCommands(ping),
    channels: defineChannels(globalChannel)
  }),
  commandHandlers: {
    ping: () => undefined
  }
});
const debugSnapshot = runtime.inspectRuntime();

type ShouldKeepCommandHandlerNames = Assert<
  IsEqual<typeof debugSnapshot.commandHandlerNames, readonly ("ping")[]>
>;

type ShouldKeepActiveChannelContractType = Assert<
  IsEqual<
    (typeof debugSnapshot.activeChannels)[number]["contract"],
    typeof globalChannel
  >
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
