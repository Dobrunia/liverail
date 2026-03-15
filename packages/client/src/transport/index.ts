import type { CommandResult } from "dobrunia-liverail-contracts";

/**
 * Сырой outbound command request, который client runtime отправляет в transport.
 */
export interface ClientTransportCommandRequest {
  /**
   * Имя команды в transport-agnostic форме.
   */
  readonly name: string;

  /**
   * Уже нормализованный command input.
   */
  readonly input: unknown;
}

/**
 * Минимальный transport sender для command client API.
 */
export type ClientTransportCommandSender = (
  request: ClientTransportCommandRequest
) => CommandResult | Promise<CommandResult>;

/**
 * Сырой outbound channel subscription request.
 */
export interface ClientTransportChannelRequest {
  /**
   * Имя канала в transport-agnostic форме.
   */
  readonly name: string;

  /**
   * Уже нормализованный channel key.
   */
  readonly key: unknown;
}

/**
 * Минимальный transport sender для channel subscribe.
 */
export type ClientTransportChannelSubscriber = (
  request: ClientTransportChannelRequest
) => unknown | Promise<unknown>;

/**
 * Минимальный transport sender для channel unsubscribe.
 */
export type ClientTransportChannelUnsubscriber = (
  request: ClientTransportChannelRequest
) => unknown | Promise<unknown>;

/**
 * Официальные статусы transport connection lifecycle для client runtime.
 */
export type ClientTransportConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

/**
 * Transport-agnostic lifecycle event текущей client session.
 */
export interface ClientTransportConnectionEvent {
  /**
   * Текущее состояние transport session.
   */
  readonly status: ClientTransportConnectionStatus;

  /**
   * Необязательная причина сбоя transport connection lifecycle.
   */
  readonly error?: unknown;
}

/**
 * Обработчик lifecycle-событий transport соединения.
 */
export type ClientTransportConnectionReceiver = (
  event: ClientTransportConnectionEvent
) => void;

/**
 * Transport-level контекст маршрута входящего события.
 */
interface ClientTransportEventRoute {
  /**
   * Логическая transport-цель конкретной доставки.
   */
  readonly target: string;

  /**
   * Необязательный канонический channel instance id для channel-scoped delivery.
   */
  readonly channelId?: string;

  /**
   * Дополнительные сериализуемые данные transport route.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Сырой inbound event, который transport передает в client runtime.
 */
export interface ClientTransportEvent {
  /**
   * Имя события в transport-agnostic форме.
   */
  readonly name: string;

  /**
   * Сырой payload входящего события.
   */
  readonly payload: unknown;

  /**
   * Transport route конкретной доставки для correlation и cleanup safety.
   */
  readonly route: ClientTransportEventRoute;
}

/**
 * Обработчик inbound transport events внутри client runtime.
 */
export type ClientTransportEventReceiver = (
  event: ClientTransportEvent
) => void;

/**
 * Минимальный transport adapter для client runtime core.
 */
export interface ClientTransport {
  /**
   * Выполняет transport-отправку typed команды.
   */
  readonly sendCommand?: ClientTransportCommandSender;

  /**
   * Выполняет transport-подписку на конкретный channel instance.
   */
  readonly subscribeChannel?: ClientTransportChannelSubscriber;

  /**
   * Выполняет transport-отписку от конкретного channel instance.
   */
  readonly unsubscribeChannel?: ClientTransportChannelUnsubscriber;

  /**
   * Регистрирует receiver lifecycle-событий transport соединения.
   */
  readonly bindConnection?: (
    receiver: ClientTransportConnectionReceiver
  ) => void | (() => void);

  /**
   * Регистрирует receiver входящих transport events и может вернуть cleanup.
   */
  readonly bindEvents?: (
    receiver: ClientTransportEventReceiver
  ) => void | (() => void);

  /**
   * Явное завершение transport binding, если transport его поддерживает.
   */
  readonly dispose?: () => void;
}
