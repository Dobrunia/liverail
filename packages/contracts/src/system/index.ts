import type { RealtimeErrorPayload } from "../errors/index.ts";
import { deepFreeze } from "../shared/object.ts";

/**
 * Официальные имена встроенных системных realtime-событий.
 */
export const SYSTEM_EVENT_NAMES = Object.freeze([
  "connected",
  "disconnected",
  "reconnect_started",
  "reconnect_succeeded",
  "connection_failed",
  "join_failed"
] as const);

/**
 * Единый lifecycle state для system events соединения.
 */
export type SystemConnectionLifecycleState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

/**
 * Официальное имя встроенного системного realtime-события.
 */
export type SystemEventName = (typeof SYSTEM_EVENT_NAMES)[number];

/**
 * Таблица payload-ов встроенных системных realtime-событий.
 */
export interface SystemEventPayloadMap {
  /**
   * Успешное первичное подключение клиента.
   */
  readonly connected: {
    readonly state: "connected";
    readonly previousState?: SystemConnectionLifecycleState;
  };

  /**
   * Явное отключение transport-соединения.
   */
  readonly disconnected: {
    readonly state: "disconnected";
    readonly previousState?: SystemConnectionLifecycleState;
  };

  /**
   * Начало reconnect-цикла transport-а.
   */
  readonly reconnect_started: {
    readonly state: "reconnecting";
    readonly previousState?: SystemConnectionLifecycleState;
  };

  /**
   * Успешное восстановление соединения после reconnect.
   */
  readonly reconnect_succeeded: {
    readonly state: "connected";
    readonly previousState?: SystemConnectionLifecycleState;
  };

  /**
   * Терминальный сбой подключения или reconnect.
   */
  readonly connection_failed: {
    readonly state: "failed";
    readonly previousState?: SystemConnectionLifecycleState;
    readonly error: RealtimeErrorPayload;
  };

  /**
   * Неуспешная попытка join/subscribe в канал.
   */
  readonly join_failed: {
    readonly channelName: string;
    readonly key: unknown;
    readonly error: RealtimeErrorPayload;
  };
}

/**
 * Получает payload по имени встроенного системного события.
 */
export type SystemEventPayload<
  TName extends SystemEventName = SystemEventName
> = SystemEventPayloadMap[TName];

/**
 * Официальная модель встроенного системного realtime-события.
 */
export interface SystemEvent<TName extends SystemEventName = SystemEventName> {
  /**
   * Явная маркировка служебного события, отличающая его от domain event.
   */
  readonly kind: "system-event";

  /**
   * Официальное имя служебного события.
   */
  readonly name: TName;

  /**
   * Typed payload служебного события.
   */
  readonly payload: SystemEventPayload<TName>;
}

/**
 * Создает явно маркированное системное realtime-событие.
 */
export function createSystemEvent<TName extends SystemEventName>(
  name: TName,
  payload: SystemEventPayload<TName>
): SystemEvent<TName> {
  if (!isSystemEventName(name)) {
    throw new TypeError(`Unknown system event name: "${name}".`);
  }

  return deepFreeze({
    kind: "system-event",
    name,
    payload
  }) as SystemEvent<TName>;
}

/**
 * Проверяет, что строка является официальным именем системного события.
 */
export function isSystemEventName(value: string): value is SystemEventName {
  return (SYSTEM_EVENT_NAMES as readonly string[]).includes(value);
}
