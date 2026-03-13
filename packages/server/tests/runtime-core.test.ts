import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  policy
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что server runtime создается вокруг явного contract registry
 * и не требует transport-specific зависимостей уже на базовом уровне.
 * Это важно, потому что runtime core должен стать центральной точкой сервера,
 * но при этом оставаться независимым от конкретного сокета или адаптера.
 * Также покрывается corner case со всеми видами contracts сразу, чтобы core
 * с первого шага опирался на полный registry, а не только на commands.
 */
test("should create a transport-agnostic server runtime around an explicit registry", () => {
  const sendMessage = command("send-message", {
    input: z.object({
      roomId: z.string(),
      body: z.string()
    }),
    ack: z.object({
      messageId: z.string()
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
    commands: [sendMessage] as const,
    events: [messageCreated] as const,
    channels: [voiceRoom] as const,
    policies: [canSend] as const
  });

  const runtime = createServerRuntime({
    registry
  });

  assert.equal(runtime.registry, registry);
  assert.ok(Object.isFrozen(runtime));
  assert.equal(runtime.resolveCommand("send-message"), sendMessage);
  assert.equal(runtime.resolveEvent("message-created"), messageCreated);
  assert.equal(runtime.resolveChannel("voice-room"), voiceRoom);
  assert.equal(runtime.resolvePolicy("can-send"), canSend);
});

/**
 * Проверяет, что runtime core дает единый typed lookup для каждого вида
 * контракта и корректно возвращает `undefined` для неизвестных имен.
 * Это важно, потому что следующие pipeline-слои должны зависеть от одного
 * места резолва contracts, а не от прямых обращений к registry снаружи.
 * Также покрывается corner case с неизвестными именами разных bucket-ов,
 * чтобы runtime вел себя предсказуемо во всех каналах доступа.
 */
test("should resolve known contracts and return undefined for unknown names", () => {
  const ping = command("ping", {
    input: z.void(),
    ack: z.void()
  });
  const heartbeat = event("heartbeat", {
    payload: z.void()
  });
  const globalChannel = channel("global", {
    key: z.void()
  });
  const canConnect = policy("can-connect", {
    evaluate: () => true
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [heartbeat] as const,
      channels: [globalChannel] as const,
      policies: [canConnect] as const
    })
  });

  assert.equal(runtime.resolveCommand("ping"), ping);
  assert.equal(runtime.resolveCommand("missing-command"), undefined);
  assert.equal(runtime.resolveEvent("heartbeat"), heartbeat);
  assert.equal(runtime.resolveEvent("missing-event"), undefined);
  assert.equal(runtime.resolveChannel("global"), globalChannel);
  assert.equal(runtime.resolveChannel("missing-channel"), undefined);
  assert.equal(runtime.resolvePolicy("can-connect"), canConnect);
  assert.equal(runtime.resolvePolicy("missing-policy"), undefined);
});

/**
 * Проверяет, что runtime core явно требует registry даже если типовая защита
 * была обойдена через небезопасный cast.
 * Это важно, потому что server runtime без registry теряет общий источник правды
 * и дальше все pipeline-слои начинают работать в неопределенном состоянии.
 * Также покрывается corner case с runtime-вызовом без опций, чтобы ошибка
 * возникала сразу в конструкторе runtime, а не позже в глубине pipeline.
 */
test("should reject runtime creation without an explicit registry", () => {
  assert.throws(
    () =>
      createServerRuntime(undefined as never),
    {
      name: "TypeError",
      message: "Server runtime requires a contract registry."
    }
  );
});
