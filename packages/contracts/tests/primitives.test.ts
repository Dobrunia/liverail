import { test } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";

import { channel, command, event, policy } from "../src/index.ts";

/**
 * Проверяет, что фабрика команды создает минимальный декларативный контракт
 * с устойчивой формой и неизменяемыми метаданными.
 * Это важно, потому что command-примитив станет базой для всего client-to-server API
 * и не должен зависеть от внешних мутаций после объявления.
 * Дополнительно тест учитывает edge case с вложенными метаданными, которые тоже
 * должны быть защищены от случайного изменения.
 */
test("should create an immutable command contract with copied metadata", () => {
  const metadata = {
    scope: "chat",
    nested: {
      version: 1
    }
  };

  const contract = command("send-message", {
    description: "Отправка сообщения в чат.",
    metadata,
    input: z.object({
      roomId: z.string(),
      body: z.string()
    }),
    ack: z.object({
      messageId: z.string()
    })
  });

  metadata.nested.version = 2;

  assert.equal(contract.kind, "command");
  assert.equal(contract.name, "send-message");
  assert.equal(contract.description, "Отправка сообщения в чат.");
  assert.deepEqual(contract.metadata, {
    scope: "chat",
    nested: {
      version: 1
    }
  });
  assert.notEqual(contract.metadata, metadata);
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.metadata));
  assert.ok(Object.isFrozen(contract.metadata.nested));
  assert.throws(() => {
    (contract.metadata as { nested: { version: number } }).nested.version = 3;
  });
});

/**
 * Проверяет, что фабрика события создает декларативный event-контракт
 * с явным видом сущности и без лишней runtime-магии.
 * Это важно, потому что события должны оставаться простыми и читаемыми,
 * а edge case с отсутствием опций не должен требовать служебных полей.
 */
test("should create an event contract with a minimal stable shape", () => {
  const payloadSchema = z.void();
  const contract = event("message-created", {
    payload: payloadSchema
  });

  assert.equal(contract.kind, "event");
  assert.equal(contract.name, "message-created");
  assert.equal(contract.payload, payloadSchema);
  assert.ok(Object.isFrozen(contract));
});

/**
 * Проверяет, что фабрика канала создает channel-контракт с тем же декларативным
 * подходом, что и остальные примитивы.
 * Это важно для будущей typed-модели подписок и комнат.
 * Дополнительно покрывается edge case с произвольными пользовательскими метаданными,
 * которые должны сохраняться без изменений и быть доступны в рантайме как read-only.
 */
test("should create a channel contract with frozen metadata", () => {
  const contract = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    }),
    metadata: {
      transport: "socket"
    }
  });

  assert.equal(contract.kind, "channel");
  assert.equal(contract.name, "voice-room");
  assert.deepEqual(contract.metadata, {
    transport: "socket"
  });
  assert.ok(Object.isFrozen(contract.metadata));
});

/**
 * Проверяет, что policy-примитив хранит evaluator и делегирует ему контекст
 * без скрытых преобразований.
 * Это важно, потому что policy должна быть минимальной и понятной основой
 * для последующих connect/join/command/receive правил.
 * Также покрывается edge case с асинхронным результатом, чтобы primitive не
 * ограничивал будущую реализацию только синхронными проверками.
 */
test("should create a policy contract that preserves evaluator behavior", async () => {
  const contract = policy("is-member", {
    description: "Проверяет участие пользователя в комнате.",
    evaluate: async (context: { userId: string; members: string[] }) =>
      context.members.includes(context.userId)
  });

  assert.equal(contract.kind, "policy");
  assert.equal(contract.name, "is-member");
  assert.equal(contract.description, "Проверяет участие пользователя в комнате.");
  assert.equal(
    await contract.evaluate({
      userId: "u1",
      members: ["u1", "u2"]
    }),
    true
  );
  assert.equal(
    await contract.evaluate({
      userId: "u3",
      members: ["u1", "u2"]
    }),
    false
  );
  assert.ok(Object.isFrozen(contract));
});

/**
 * Проверяет, что все primitive-фабрики отклоняют пустые и пробельные имена.
 * Это важно, потому что такие значения приводят к неявным коллизиям и
 * разъезжающемуся контрактному слою еще до появления registry и transport.
 * Тест покрывает corner cases с пустой строкой и строкой из одних пробелов,
 * чтобы ошибка возникала сразу в точке объявления.
 */
test("should reject empty or blank names for all contract primitives", () => {
  const emptyName = "";
  const blankName = "   ";
  const factories = [
    () =>
      command(emptyName, {
        input: z.void(),
        ack: z.void()
      }),
    () =>
      command(blankName, {
        input: z.void(),
        ack: z.void()
      }),
    () =>
      event(emptyName, {
        payload: z.void()
      }),
    () =>
      event(blankName, {
        payload: z.void()
      }),
    () =>
      channel(emptyName, {
        key: z.void()
      }),
    () =>
      channel(blankName, {
        key: z.void()
      }),
    () =>
      policy(emptyName, {
        evaluate: () => true
      }),
    () =>
      policy(blankName, {
        evaluate: () => true
      })
  ];

  for (const factory of factories) {
    assert.throws(factory, {
      name: "TypeError"
    });
  }
});
