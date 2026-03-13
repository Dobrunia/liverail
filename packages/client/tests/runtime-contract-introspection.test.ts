import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.ts";

/**
 * Проверяет, что client runtime тоже публикует единый introspection-слой и
 * дает UI/debug-коду официальный read-only список зарегистрированных contracts.
 * Это важно, потому что клиентский runtime уже стал центральной точкой API и
 * operational слой должен читать его состояние без прямого доступа к registry.
 * Также покрывается corner case с частичным registry, чтобы introspection API
 * оставался предсказуемым даже если policies на клиенте отсутствуют полностью.
 */
test("should expose contract introspection through the client runtime", () => {
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
  const introspection = runtime.inspectContracts();

  assert.equal(Object.isFrozen(introspection), true);
  assert.deepEqual(introspection.commands.names, ["ping"]);
  assert.deepEqual(introspection.events.names, ["heartbeat"]);
  assert.deepEqual(introspection.channels.names, ["global"]);
  assert.equal(introspection.commands.byName.ping, ping);
});
