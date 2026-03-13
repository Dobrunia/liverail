import { z } from "zod";

import {
  normalizeValidationError,
  type RealtimeValidationErrorCode
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что нормализатор сохраняет literal code
 * validation-ошибки и возвращает typed details со списком issues.
 * Это важно, потому что downstream runtime должен иметь доступ к стабильному
 * typed error shape без ручного narrowing после нормализации.
 * Также покрывается corner case с runtime Error, а не только с ZodError.
 */
type ShouldReturnTypedNormalizedValidationErrors = Assert<
  IsEqual<typeof normalizedError.code, "invalid-input"> &
    IsEqual<RealtimeValidationErrorCode, "invalid-input" | "invalid-ack" | "invalid-event-payload" | "invalid-channel-key"> &
    IsEqual<typeof normalizedError.details.source, "runtime" | "zod">
>;

const normalizedError = normalizeValidationError(new TypeError("Schema crashed."), {
  code: "invalid-input",
  message: "Command input validation failed.",
  details: {
    schemaName: "set-volume"
  }
});

normalizeValidationError(new Error("Boom"), {
  // @ts-expect-error validation normalization must use only validation-related error codes
  code: "timeout",
  message: "Should fail."
});

z;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
