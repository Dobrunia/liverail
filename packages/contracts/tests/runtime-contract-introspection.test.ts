import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  inspectContractRegistry,
  policy
} from "../src/index.ts";

/**
 * Проверяет, что introspection registry возвращает явный и read-only срез
 * зарегистрированных контрактов без обхода внутренних bucket-структур руками.
 * Это важно, потому что debug/tooling-слой должен получать стабильный снимок
 * команд, событий, каналов и policies из официального API, а не из внутренних
 * деталей реализации registry.
 * Также покрывается corner case с сохранением порядка регистрации и массива
 * имен, чтобы последующие debug-утилиты могли строиться на детерминированном
 * представлении без дополнительной нормализации.
 */
test("should expose a read-only contract introspection snapshot from the registry", () => {
  const sendMessage = command("send-message", {
    input: z.void(),
    ack: z.void()
  });
  const messageCreated = event("message-created", {
    payload: z.void()
  });
  const voiceRoom = channel("voice-room", {
    key: z.void()
  });
  const canConnect = policy("can-connect", {
    evaluate: () => true
  });
  const registry = createContractRegistry({
    commands: [sendMessage] as const,
    events: [messageCreated] as const,
    channels: [voiceRoom] as const,
    policies: [canConnect] as const
  });
  const introspection = inspectContractRegistry(registry);

  assert.equal(Object.isFrozen(introspection), true);
  assert.equal(Object.isFrozen(introspection.commands), true);
  assert.equal(Object.isFrozen(introspection.commands.names), true);
  assert.deepEqual(introspection.commands.list, [sendMessage]);
  assert.deepEqual(introspection.events.list, [messageCreated]);
  assert.deepEqual(introspection.channels.list, [voiceRoom]);
  assert.deepEqual(introspection.policies.list, [canConnect]);
  assert.deepEqual(introspection.commands.names, ["send-message"]);
  assert.deepEqual(introspection.events.names, ["message-created"]);
  assert.deepEqual(introspection.channels.names, ["voice-room"]);
  assert.deepEqual(introspection.policies.names, ["can-connect"]);
  assert.equal(introspection.commands.byName["send-message"], sendMessage);
});
