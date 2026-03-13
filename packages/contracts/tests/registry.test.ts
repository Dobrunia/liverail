import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  policy,
  type CommandContract
} from "../src/index.ts";

/**
 * Проверяет, что registry собирает contracts в детерминированные коллекции
 * с сохранением порядка и прямым lookup по имени.
 * Это важно, потому что следующие runtime-слои должны опираться на стабильную
 * модель хранения, а не на произвольные обходы массивов.
 * Также покрывается corner case с policy, чтобы registry не ограничивалась
 * только commands/events/channels и была совместима со всеми primitives.
 */
test("should create deterministic registry collections with name lookups", () => {
  const sendMessage = command("send-message", {
    input: z.object({
      roomId: z.string(),
      body: z.string()
    }),
    ack: z.object({
      messageId: z.string()
    })
  });
  const editMessage = command("edit-message", {
    input: z.object({
      messageId: z.string(),
      body: z.string()
    }),
    ack: z.object({
      updatedAt: z.string()
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      messageId: z.string()
    })
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const canSend = policy("can-send", {
    evaluate: () => true
  });

  const registry = createContractRegistry({
    commands: [sendMessage, editMessage] as const,
    events: [messageCreated] as const,
    channels: [voiceRoom] as const,
    policies: [canSend] as const
  });

  assert.deepEqual(registry.commands.list, [sendMessage, editMessage]);
  assert.equal(registry.commands.byName["send-message"], sendMessage);
  assert.equal(registry.commands.byName["edit-message"], editMessage);
  assert.equal(registry.events.byName["message-created"], messageCreated);
  assert.equal(registry.channels.byName["voice-room"], voiceRoom);
  assert.equal(registry.policies.byName["can-send"], canSend);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.commands.list));
  assert.ok(Object.isFrozen(registry.commands.byName));
});

/**
 * Проверяет, что registry отклоняет повторную регистрацию contracts с одинаковым
 * именем внутри одного bucket.
 * Это важно, потому что иначе lookup по имени станет неоднозначным и runtime
 * будет зависеть от порядка регистрации.
 * Тест учитывает corner case, когда дубликат возникает сразу при создании registry,
 * а не позже через отдельный mutating API, которого здесь быть не должно.
 */
test("should reject duplicate names within the same registry bucket", () => {
  assert.throws(
    () =>
      createContractRegistry({
        commands: [
          command("send-message", {
            input: z.void(),
            ack: z.void()
          }),
          command("send-message", {
            input: z.void(),
            ack: z.void()
          })
        ] as const
      }),
    {
      name: "TypeError",
      message: "Duplicate command contract name: send-message."
    }
  );
});

/**
 * Проверяет, что registry не использует скрытое глобальное состояние и не
 * смешивает независимые объявления между разными экземплярами.
 * Это важно, потому что registry должна быть полностью явной и детерминированной,
 * иначе последующие server/client runtime начнут зависеть от порядка импортов.
 * Дополнительно покрывается edge case с мутацией исходного массива после создания
 * registry: внутренняя list должна оставаться стабильной копией.
 */
test("should keep registries isolated from global state and source array mutations", () => {
  const firstCommand = command("first", {
    input: z.void(),
    ack: z.void()
  });
  const secondCommand = command("second", {
    input: z.void(),
    ack: z.void()
  });
  const source: CommandContract[] = [firstCommand];

  const firstRegistry = createContractRegistry({
    commands: source
  });
  const secondRegistry = createContractRegistry({
    commands: [secondCommand]
  });

  source.push(secondCommand);

  assert.deepEqual(firstRegistry.commands.list, [firstCommand]);
  assert.equal(firstRegistry.commands.byName.first, firstCommand);
  assert.deepEqual(secondRegistry.commands.list, [secondCommand]);
  assert.equal(secondRegistry.commands.byName.second, secondCommand);
});

/**
 * Проверяет, что registry валидирует соответствие bucket и kind у переданного
 * контракта даже если TypeScript-ограничения были обойдены.
 * Это важно, потому что runtime-слой не должен молча принимать event в commands
 * bucket и ломать модель registry из-за невалидного входа.
 * Тест учитывает corner case с runtime-cast, когда неправильный контракт может
 * попасть в функцию не через обычный типизированный путь.
 */
test("should reject contracts registered in the wrong bucket at runtime", () => {
  assert.throws(
    () =>
      createContractRegistry({
        commands: [
          event("message-created", {
            payload: z.object({
              messageId: z.string()
            })
          }) as unknown as ReturnType<typeof command>
        ]
      }),
    {
      name: "TypeError",
      message:
        "Expected command contract in commands registry bucket, received event: message-created."
    }
  );
});
