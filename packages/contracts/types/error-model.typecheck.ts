import {
  REALTIME_ERROR_CODES,
  createRealtimeError,
  type RealtimeErrorCode
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что realtime error code выводится из
 * официального списка кодов, а не поддерживается вручную отдельным union.
 * Это важно, потому что единый источник правды для кодов должен быть один,
 * иначе runtime-список и TypeScript-типы со временем разойдутся.
 * Также покрывается corner case с конкретным literal code, чтобы downstream-код
 * мог получать узкий тип созданной ошибки без ручного приведения.
 */
type ShouldInferRealtimeErrorCodeFromOfficialList = Assert<
  IsEqual<
    RealtimeErrorCode,
    (typeof REALTIME_ERROR_CODES)[number]
  > &
    IsEqual<typeof timeoutError.code, "timeout">
>;

const timeoutError = createRealtimeError({
  code: "timeout",
  message: "Command timed out."
});

// @ts-expect-error realtime error code must come from the official code list
createRealtimeError({ code: "custom-code", message: "Should fail." });

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
