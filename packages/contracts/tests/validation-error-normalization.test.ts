import { test } from "vitest";
import assert from "node:assert/strict";

import { ZodError, z } from "zod";

import {
  createRealtimeError,
  isRealtimeError,
  isRealtimeValidationError,
  normalizeValidationError
} from "../src/index.ts";

/**
 * Проверяет, что ZodError нормализуется в единый realtime error shape
 * с source `zod`, официальным кодом и детализированным списком issues.
 * Это важно, потому что validation errors не должны протекать сырьем в клиент
 * или серверный runtime и должны иметь одну стабильную форму.
 * Тест учитывает corner case с несколькими issue, чтобы нормализатор сохранял
 * все проблемы, а не только первую.
 */
test("should normalize zod validation errors into realtime errors with issue lists", () => {
  const schema = z.object({
    roomId: z.string().uuid(),
    level: z.coerce.number().int().min(0).max(100)
  });

  let zodError: ZodError;

  try {
    schema.parse({
      roomId: "room-1",
      level: "120"
    });
    throw new Error("Expected schema.parse to fail.");
  } catch (error) {
    assert.ok(error instanceof ZodError);
    zodError = error;
  }

  const normalized = normalizeValidationError(zodError, {
    code: "invalid-input",
    message: "Command input validation failed."
  });

  assert.equal(isRealtimeError(normalized), true);
  assert.equal(normalized.code, "invalid-input");
  assert.equal(normalized.message, "Command input validation failed.");
  assert.equal(normalized.details?.source, "zod");
  assert.equal(normalized.details?.issues.length, 2);
  assert.equal(normalized.details?.issues[0]?.path.join("."), "roomId");
  assert.equal(normalized.details?.issues[1]?.path.join("."), "level");
});

/**
 * Проверяет, что произвольная runtime-ошибка тоже нормализуется в общий
 * realtime error shape и не протекает наружу как сырой Error.
 * Это важно, потому что даже не-Zod сбои в validation pipeline должны быть
 * представлены в том же общем формате для клиента и сервера.
 * Тест учитывает corner case с вложенными дополнительными details, чтобы
 * нормализатор не терял пользовательский контекст поверх runtime source.
 */
test("should normalize runtime validation failures into realtime errors", () => {
  const normalized = normalizeValidationError(new TypeError("Schema crashed."), {
    code: "invalid-input",
    message: "Command input validation failed.",
    details: {
      stage: "command-input"
    }
  });

  assert.equal(isRealtimeError(normalized), true);
  assert.equal(normalized.code, "invalid-input");
  assert.equal(normalized.details?.source, "runtime");
  assert.equal(normalized.details?.issues[0]?.message, "Schema crashed.");
  assert.equal(normalized.details?.issues[0]?.path.length, 0);
  assert.equal(normalized.details?.stage, "command-input");
});

/**
 * Проверяет, что уже нормализованная realtime error не оборачивается повторно
 * и сохраняет ссылочную идентичность.
 * Это важно, потому что один и тот же error object может пройти через несколько
 * слоев pipeline, и двойная нормализация только размоет первичную причину.
 * Тест учитывает corner case с уже заполненными details, чтобы они не терялись
 * и не перезаписывались при повторном вызове нормализатора.
 */
test("should return the original realtime error when it is already normalized", () => {
  const original = createRealtimeError({
    code: "invalid-input",
    message: "Already normalized.",
    details: {
      source: "runtime",
      issues: []
    }
  });

  const normalized = normalizeValidationError(original, {
    code: "invalid-input",
    message: "Should not be used."
  });

  assert.equal(normalized, original);
});

/**
 * Проверяет, что отдельный runtime guard для validation-ошибок сужает тип
 * только до нормализованного validation shape и не принимает общие realtime errors.
 * Это важно, потому что downstream-код должен безопасно читать `issues`
 * и `source` без ручных кастов и без протечки `unknown`.
 * Также покрывается corner case с обычной realtime-ошибкой не из validation-слоя,
 * чтобы guard не срабатывал слишком широко.
 */
test("should detect normalized validation errors with a narrow runtime guard", () => {
  const validationError = normalizeValidationError(new TypeError("Schema crashed."), {
    code: "invalid-input"
  });
  const genericRealtimeError = createRealtimeError({
    code: "timeout",
    message: "Command timed out."
  });

  assert.equal(isRealtimeValidationError(validationError), true);
  assert.equal(isRealtimeValidationError(genericRealtimeError), false);
  assert.equal(isRealtimeValidationError(new Error("Boom")), false);
});
