import type { LiveRailRealtimeError } from "@dobrunia-liverail/contracts";

/**
 * Централизованный обработчик нормализованных ошибок client runtime.
 */
export type ClientRuntimeErrorHandler = (error: LiveRailRealtimeError) => void;

/**
 * Передает нормализованную runtime-ошибку во внешний error hook, если он задан.
 */
export function reportClientRuntimeError(
  error: LiveRailRealtimeError,
  onError: ClientRuntimeErrorHandler | undefined
): void {
  if (onError === undefined) {
    return;
  }

  try {
    onError(error);
  } catch (handlerError) {
    console.error(
      "[LiveRail] Client runtime error handler failed while handling a runtime error.",
      handlerError,
      error
    );
  }
}

/**
 * Публикует dev-only warning о неправильном использовании client runtime,
 * не влияя на production flow.
 */
export function warnClientRuntimeMisuse(message: string): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.warn(`[LiveRail] ${message}`);
}
