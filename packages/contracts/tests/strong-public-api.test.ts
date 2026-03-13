import assert from "node:assert/strict";

import { z } from "zod";
import { test } from "vitest";

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
} from "../src/index.ts";

/**
 * Проверяет, что публичные tuple-helper-ы для registry сохраняют порядок,
 * точные контракты и не требуют ручного `as const` в пользовательском коде.
 * Это важно, потому что публичный API библиотеки должен сохранять literal-типы
 * контрактов без неофициальных типовых обходов и без опоры на внутренние типы.
 * Также покрывается corner case с неизменяемостью helper-результата, чтобы
 * дальнейшая сборка registry не зависела от случайной мутации исходных массивов.
 */
test("should preserve immutable typed contract tuples through public registry helpers", () => {
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
  const commands = defineCommands(sendMessage);
  const events = defineEvents(messageCreated);
  const channels = defineChannels(voiceRoom);
  const policies = definePolicies(canConnect);
  const registry = createContractRegistry({
    commands,
    events,
    channels,
    policies
  });

  assert.equal(Object.isFrozen(commands), true);
  assert.equal(Object.isFrozen(events), true);
  assert.equal(Object.isFrozen(channels), true);
  assert.equal(Object.isFrozen(policies), true);
  assert.deepEqual(registry.commands.list, [sendMessage]);
  assert.deepEqual(registry.events.list, [messageCreated]);
  assert.deepEqual(registry.channels.list, [voiceRoom]);
  assert.deepEqual(registry.policies.list, [canConnect]);
});
