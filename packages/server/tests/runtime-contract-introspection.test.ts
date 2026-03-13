import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что server runtime дает официальный introspection-слой поверх
 * registry и не заставляет debug-код читать внутренние структуры runtime
 * напрямую. Это важно, потому что operational tooling должен иметь безопасную
 * точку входа в список зарегистрированных контрактов без зависимости от
 * приватного устройства серверного runtime.
 * Также покрывается corner case с неизменяемостью результата, чтобы наружный
 * код не мог случайно влиять на runtime через introspection API.
 */
test("should expose contract introspection through the server runtime", () => {
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
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [heartbeat] as const,
      channels: [globalChannel] as const
    })
  });
  const introspection = runtime.inspectContracts();

  assert.equal(Object.isFrozen(introspection), true);
  assert.deepEqual(introspection.commands.names, ["ping"]);
  assert.deepEqual(introspection.events.names, ["heartbeat"]);
  assert.deepEqual(introspection.channels.names, ["global"]);
  assert.equal(introspection.commands.byName.ping, ping);
});
