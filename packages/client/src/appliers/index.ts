import {
  parseEventPayload,
  type EventContract,
  type EventPayload,
  type ResolveSchemaInput
} from "@dobrunia-liverail/contracts";

/**
 * Pure-функция применения typed события к текущему состоянию.
 */
export type ClientEventApplier<
  TEvent extends EventContract = EventContract,
  TState = unknown
> = (state: TState, payload: EventPayload<TEvent>) => TState;

/**
 * Декларативное описание event applier, привязанное к конкретному event contract.
 */
export interface ClientEventApplierDefinition<
  TEvent extends EventContract = EventContract,
  TState = unknown
> {
  /**
   * Event contract, для которого описан state update.
   */
  readonly event: TEvent;

  /**
   * Pure state transition для нормализованного payload события.
   */
  readonly apply: ClientEventApplier<TEvent, TState>;
}

/**
 * Store-agnostic интерфейс доступа к текущему состоянию и записи следующего.
 */
export interface ClientStateStore<TState = unknown> {
  /**
   * Возвращает текущее состояние для event-to-state перехода.
   */
  readonly getState: () => TState;

  /**
   * Сохраняет следующее состояние после применения события.
   */
  readonly setState: (state: TState) => void;
}

/**
 * Создает store-agnostic event applier, привязанный к typed event contract.
 */
export function eventApplier<
  TEvent extends EventContract,
  TState
>(
  event: TEvent,
  apply: ClientEventApplier<TEvent, TState>
): ClientEventApplierDefinition<TEvent, TState> {
  if (typeof apply !== "function") {
    throw new TypeError("Event applier must be a function.");
  }

  return Object.freeze({
    event,
    apply
  });
}

/**
 * Валидирует payload по event contract и применяет его к текущему состоянию.
 */
export function applyEventApplier<
  TEvent extends EventContract,
  TState
>(
  applier: ClientEventApplierDefinition<TEvent, TState>,
  state: TState,
  payload: ResolveSchemaInput<TEvent["payload"]>
): TState {
  return applier.apply(
    state,
    parseEventPayload(applier.event, payload)
  );
}
