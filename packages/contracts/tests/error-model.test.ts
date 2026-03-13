import test from "node:test";
import assert from "node:assert/strict";

import {
  REALTIME_ERROR_CODES,
  createRealtimeError,
  isRealtimeError
} from "../src/index.ts";

/**
 * Проверяет, что unified error model публикует официальный список кодов ошибок,
 * покрывающий базовые отказные сценарии библиотеки.
 * Это важно, потому что и клиент, и сервер должны опираться на один и тот же
 * набор кодов, а не добавлять строковые значения хаотично.
 * Также покрывается corner case с channel key validation: код для него нужен
 * уже сейчас, потому что validation layer для каналов уже реализован.
 */
test("should expose the official realtime error code list", () => {
  assert.deepEqual(REALTIME_ERROR_CODES, [
    "invalid-input",
    "invalid-ack",
    "invalid-event-payload",
    "invalid-channel-key",
    "unauthorized",
    "forbidden",
    "connection-denied",
    "join-denied",
    "command-failed",
    "timeout",
    "internal-error"
  ]);
  assert.ok(Object.isFrozen(REALTIME_ERROR_CODES));
});

/**
 * Проверяет, что realtime error создается в стабильном едином shape и остается
 * пригодной как для instanceof Error, так и для сериализации.
 * Это важно, потому что unified error model должна одинаково работать в runtime,
 * логировании и transport-передаче между слоями системы.
 * Тест учитывает corner case с вложенными details, которые тоже должны быть
 * защищены от случайной мутации после создания ошибки.
 */
test("should create immutable realtime errors with a stable serializable shape", () => {
  const error = createRealtimeError({
    code: "forbidden",
    message: "User cannot execute this command.",
    details: {
      contract: {
        kind: "command",
        name: "kick-user"
      }
    }
  });

  assert.equal(error.name, "LiveRailRealtimeError");
  assert.equal(error.code, "forbidden");
  assert.equal(error.message, "User cannot execute this command.");
  assert.deepEqual(error.details, {
    contract: {
      kind: "command",
      name: "kick-user"
    }
  });
  assert.ok(error instanceof Error);
  assert.ok(isRealtimeError(error));
  assert.ok(Object.isFrozen(error.details));
  assert.ok(Object.isFrozen((error.details as { contract: object }).contract));
  assert.deepEqual(error.toJSON(), {
    name: "LiveRailRealtimeError",
    code: "forbidden",
    message: "User cannot execute this command.",
    details: {
      contract: {
        kind: "command",
        name: "kick-user"
      }
    }
  });
});

/**
 * Проверяет, что unified error model отклоняет неизвестные коды уже в момент
 * создания ошибки, а не позволяет протащить произвольную строку дальше по системе.
 * Это важно, потому что хаотичные коды быстро ломают предсказуемость клиента,
 * сервера и LLM-инструментов, которые будут на них опираться.
 * Также покрывается corner case с runtime-обходом TypeScript через `as never`,
 * чтобы защита существовала не только на уровне типов.
 */
test("should reject unsupported realtime error codes at runtime", () => {
  assert.throws(
    () =>
      createRealtimeError({
        code: "not-official" as never,
        message: "Unknown error code."
      }),
    {
      name: "TypeError",
      message: 'Unsupported realtime error code: "not-official".'
    }
  );
});

/**
 * Проверяет, что runtime guard отличает официальные realtime errors от обычных
 * Error-объектов и посторонних значений.
 * Это важно, потому что downstream слои будут получать ошибки из разных источников
 * и должны безопасно понимать, когда перед ними уже нормализованный общий формат.
 * Тест учитывает corner cases с plain object и обычным Error, чтобы guard не был
 * слишком широким и не принимал похожие, но неофициальные структуры.
 */
test("should detect realtime errors without accepting arbitrary error-like values", () => {
  const realtimeError = createRealtimeError({
    code: "timeout",
    message: "Command timed out."
  });

  assert.equal(isRealtimeError(realtimeError), true);
  assert.equal(isRealtimeError(new Error("Timeout")), false);
  assert.equal(
    isRealtimeError({
      name: "LiveRailRealtimeError",
      code: "timeout",
      message: "Command timed out."
    }),
    false
  );
  assert.equal(isRealtimeError(null), false);
});
