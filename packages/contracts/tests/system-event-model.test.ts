import assert from "node:assert/strict";

import { test } from "vitest";

import {
  SYSTEM_EVENT_NAMES,
  createSystemEvent,
  isSystemEventName
} from "../src/index.ts";

/**
 * Проверяет, что системные realtime-события имеют отдельную официальную
 * модель и явную маркировку, а не маскируются под обычные domain events.
 * Это важно, потому что lifecycle и operational-сигналы должны быть
 * различимы на уровне API и tooling без строковых соглашений.
 * Также покрывается corner case с immutable shape, чтобы runtime и UI
 * получали стабильный read-only объект системного события.
 */
test("should create explicitly marked system events without mixing them with domain events", () => {
  const systemEvent = createSystemEvent("connected", {
    state: "connected",
    previousState: "connecting"
  });

  assert.equal(Object.isFrozen(systemEvent), true);
  assert.equal(Object.isFrozen(systemEvent.payload), true);
  assert.equal(systemEvent.kind, "system-event");
  assert.equal(systemEvent.name, "connected");
  assert.deepEqual(systemEvent.payload, {
    state: "connected",
    previousState: "connecting"
  });
});

/**
 * Проверяет, что официальные имена system events зафиксированы в одном
 * месте и могут безопасно использоваться для runtime-guard логики.
 * Это важно, потому что client runtime и внешние потребители должны
 * опираться на стабильный список служебных событий, а не собирать его
 * вручную из разрозненных состояний lifecycle и transport-ошибок.
 * Также покрывается corner case с неизвестным именем, чтобы guard не
 * принимал произвольные строки за официальные system events.
 */
test("should expose a stable official list of supported system event names", () => {
  assert.equal(Object.isFrozen(SYSTEM_EVENT_NAMES), true);
  assert.deepEqual(SYSTEM_EVENT_NAMES, [
    "connected",
    "disconnected",
    "reconnect_started",
    "reconnect_succeeded",
    "connection_failed",
    "join_failed"
  ]);
  assert.equal(isSystemEventName("connected"), true);
  assert.equal(isSystemEventName("join_failed"), true);
  assert.equal(isSystemEventName("message-created"), false);
});
