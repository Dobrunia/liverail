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
