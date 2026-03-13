import { z } from "zod";

import {
  channel,
  createContractRegistry,
  type ChannelKey
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что typed channel subscription API сохраняет
 * точные типы key и результата subscribe/unsubscribe для конкретного канала.
 * Это важно, потому что подписки на клиенте должны быть контрактными и не
 * деградировать в набор raw string room names и `unknown` ключей.
 * Также покрывается corner case с `unsubscribeChannel`, чтобы сигнатуры
 * обоих методов работали от одного и того же channel contract.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    channels: [voiceRoom] as const
  }),
  transport: {
    subscribeChannel() {
      return undefined;
    },
    unsubscribeChannel() {
      return undefined;
    }
  }
});

const pendingSubscription = runtime.subscribeChannel("voice-room", {
  roomId: "room-1"
});
const pendingUnsubscribe = runtime.unsubscribeChannel("voice-room", {
  roomId: "room-1"
});

type ShouldReturnTypedSubscription = Assert<
  IsEqual<
    typeof pendingSubscription,
    Promise<{
      readonly contract: typeof voiceRoom;
      readonly name: "voice-room";
      readonly key: ChannelKey<typeof voiceRoom>;
      readonly id: string;
    }>
  >
>;

type ShouldReturnTypedUnsubscribeResult = Assert<
  IsEqual<typeof pendingUnsubscribe, Promise<boolean>>
>;

runtime.subscribeChannel("voice-room", {
  // @ts-expect-error subscription API must enforce the known key schema
  roomId: 42
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
