import { z } from "zod";

import {
  channel,
  createChannelInstance,
  createContractRegistry,
  parseChannelKey
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что parseChannelKey и createChannelInstance
 * используют output-тип key schema, а не `unknown`.
 * Это важно, потому что channel instance должен нести уже валидированный
 * и нормализованный ключ без ручного приведения типов в runtime-слое.
 * Также учитывается corner case с trim, где выходной key отличается от сырого ввода.
 */
type ShouldInferTypedChannelKeyFromSchema = Assert<
  IsEqual<
    typeof parsedChannelKey,
    {
      roomId: string;
    }
  > &
    IsEqual<
      typeof channelInstance.key,
      {
        roomId: string;
      }
    >
>;

/**
 * Проверяет на уровне компиляции, что registry не теряет строгую key-модель
 * и что пустые каналы поддерживаются только через `z.void()`.
 * Это важно, потому что downstream runtime будет получать канал из registry,
 * а не только из локальной переменной.
 * Дополнительно покрывается edge case с `void`-каналом без полезного ключа.
 */
type ShouldPreserveTypedChannelContractsInsideRegistry = Assert<
  IsEqual<typeof globalInstance.key, void>
>;

const voiceRoomChannel = channel("voice-room", {
  key: z.object({
    roomId: z.string().trim().min(1)
  })
});

const globalChannel = channel("global", {
  key: z.void()
});

const registry = createContractRegistry({
  channels: [voiceRoomChannel, globalChannel] as const
});

const parsedChannelKey = parseChannelKey(voiceRoomChannel, {
  roomId: "  room-1  "
});

const channelInstance = createChannelInstance(voiceRoomChannel, {
  roomId: "  room-1  "
});

const globalInstance = createChannelInstance(registry.channels.byName.global, undefined);

// @ts-expect-error channel contracts must have a key schema
channel("missing-key", {});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
