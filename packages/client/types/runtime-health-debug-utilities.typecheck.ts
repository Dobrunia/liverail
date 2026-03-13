import { z } from "zod";

import {
  channel,
  createContractRegistry,
  defineChannels,
  defineEvents,
  event
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что client debug snapshot сохраняет literal-имена
 * contracts и typed active subscription entries. Это важно, потому что debug
 * surface должен быть пригоден и для authoring-time tooling, а не только для
 * runtime-консоли.
 * Также покрывается corner case с listener names, чтобы client debug utility
 * не сводился к обычным `string[]` без связи с registry literal names.
 */
const heartbeat = event("heartbeat", {
  payload: z.void()
});
const globalChannel = channel("global", {
  key: z.object({
    roomId: z.string()
  })
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    events: defineEvents(heartbeat),
    channels: defineChannels(globalChannel)
  })
});
const debugSnapshot = runtime.inspectRuntime();

type ShouldKeepListenerNames = Assert<
  IsEqual<typeof debugSnapshot.eventListenerNames, readonly ("heartbeat")[]>
>;

type ShouldKeepSubscriptionContractType = Assert<
  IsEqual<
    (typeof debugSnapshot.activeSubscriptions)[number]["contract"],
    typeof globalChannel
  >
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
