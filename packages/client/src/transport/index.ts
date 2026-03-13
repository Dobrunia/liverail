import type { CommandResult } from "@liverail/contracts";

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
export type ClientTransportConnectionStatus = "connected" | "disconnected";

/**
 * Transport-agnostic lifecycle event текущей client session.
 */
export interface ClientTransportConnectionEvent {
  /**
   * Текущее состояние transport session.
   */
  readonly status: ClientTransportConnectionStatus;
}

/**
 * Обработчик lifecycle-событий transport соединения.
 */
export type ClientTransportConnectionReceiver = (
  event: ClientTransportConnectionEvent
) => void;

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
