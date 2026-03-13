import type { LiveRailRealtimeError } from "@liverail/contracts";

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
  onError?.(error);
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
