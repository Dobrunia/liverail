import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.ts";

/**
 * Проверяет, что client runtime строится вокруг explicit registry и
 * transport binding, не привязываясь к конкретному transport API.
 * Это важно, потому что клиентский слой должен быть единой точкой входа
 * для следующих command/subscribe/on возможностей, но оставаться transport-agnostic.
 * Также покрывается corner case с `destroy`, чтобы runtime корректно снимал
 * transport binding и не оставлял висящие слушатели после завершения работы.
 */
test("should create a transport-agnostic client runtime around an explicit registry", () => {
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
  const registry = createContractRegistry({
    commands: [ping] as const,
    events: [heartbeat] as const,
    channels: [globalChannel] as const
  });
  const calls: string[] = [];
  const runtime = createClientRuntime({
    registry,
    transport: {
      bindEvents(receiver) {
        calls.push("bind");
        assert.equal(typeof receiver, "function");
        return () => {
          calls.push("unbind");
        };
      },
      dispose() {
        calls.push("dispose");
      }
    }
  });

  assert.equal(runtime.registry, registry);
  runtime.destroy();
  runtime.destroy();

  assert.deepEqual(calls, ["bind", "unbind", "dispose"]);
});

/**
 * Проверяет, что runtime core разрешает известные contracts из registry и
 * безопасно возвращает `undefined` для неизвестных имен.
 * Это важно, потому что дальнейшие client API будут строиться поверх typed
 * resolve-операций, а не поверх строковых соглашений.
 * Также покрывается corner case с неизвестным именем, чтобы fallback-поведение
 * оставалось предсказуемым и не притворялось известным контрактом.
 */
test("should resolve known client contracts and return undefined for unknown names", () => {
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
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [heartbeat] as const,
      channels: [globalChannel] as const
    })
  });

  assert.equal(runtime.resolveCommand("ping"), ping);
  assert.equal(runtime.resolveEvent("heartbeat"), heartbeat);
  assert.equal(runtime.resolveChannel("global"), globalChannel);
  assert.equal(runtime.resolveCommand("unknown-command"), undefined);
});

/**
 * Проверяет, что создание client runtime без explicit registry отклоняется
 * сразу и не приводит к полусконфигурированному состоянию.
 * Это важно, потому что registry является источником правды для всего
 * клиентского runtime и не должен быть неявной глобальной зависимостью.
 * Также покрывается corner case с `undefined`, чтобы ошибка возникала на
 * старте, а не позже при первом вызове command/subscribe/on API.
 */
test("should reject client runtime creation without an explicit registry", () => {
  assert.throws(
    () =>
      createClientRuntime({
        registry: undefined as never
      }),
    {
      name: "TypeError",
      message: "Client runtime requires a contract registry."
    }
  );
});
