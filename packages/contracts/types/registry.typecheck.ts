import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  policy
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что registry сохраняет точные типы контрактов
 * в `byName` и не теряет literal names при построении коллекций.
 * Это важно, потому что server/client runtime дальше должны получать строгий lookup
 * по имени без ручных generic-аннотаций и без ослабления до `string`.
 * Также учитывается corner case с несколькими bucket-ами, чтобы типизация была
 * согласованной для command/event/channel/policy одновременно.
 */
type ShouldPreserveTypedLookupsInRegistry = Assert<
  IsEqual<
    typeof registry.commands.byName["send-message"],
    typeof sendMessageCommand
  > &
    IsEqual<
      typeof registry.events.byName["message-created"],
      typeof messageCreatedEvent
    > &
    IsEqual<typeof registry.channels.byName["voice-room"], typeof voiceRoomChannel> &
    IsEqual<typeof registry.policies.byName["can-send"], typeof canSendPolicy>
>;

/**
 * Проверяет на уровне компиляции, что registry сохраняет tuple-порядок исходных
 * списков контрактов, а не размывает их до обычных массивов.
 * Это важно для детерминированной модели и для тех мест, где порядок объявления
 * должен быть доступен tooling или runtime без дополнительных преобразований.
 * Дополнительно покрывается edge case с разным количеством элементов в bucket-ах,
 * чтобы типовая система не зависела от симметричной структуры registry.
 */
type ShouldPreserveRegistryListTuples = Assert<
  IsEqual<
    typeof registry.commands.list,
    readonly [typeof sendMessageCommand, typeof editMessageCommand]
  > &
    IsEqual<typeof registry.events.list, readonly [typeof messageCreatedEvent]> &
    IsEqual<typeof registry.channels.list, readonly [typeof voiceRoomChannel]> &
    IsEqual<typeof registry.policies.list, readonly [typeof canSendPolicy]>
>;

const sendMessageCommand = command("send-message", {
  input: z.object({
    roomId: z.string(),
    body: z.string()
  }),
  ack: z.object({
    messageId: z.string()
  })
});
const editMessageCommand = command("edit-message", {
  input: z.object({
    messageId: z.string()
  }),
  ack: z.object({
    updatedAt: z.string()
  })
});
const messageCreatedEvent = event("message-created", {
  payload: z.object({
    messageId: z.string()
  })
});
const voiceRoomChannel = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const canSendPolicy = policy("can-send", {
  evaluate: () => true
});

const registry = createContractRegistry({
  commands: [sendMessageCommand, editMessageCommand] as const,
  events: [messageCreatedEvent] as const,
  channels: [voiceRoomChannel] as const,
  policies: [canSendPolicy] as const
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
