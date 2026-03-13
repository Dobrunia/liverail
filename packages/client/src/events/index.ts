import type {
  EventContract,
  EventPayload,
  SystemEvent,
  SystemEventName
} from "@liverail/contracts";

/**
 * Пользовательский listener конкретного typed события.
 */
export type ClientEventListener<
  TEvent extends EventContract = EventContract
> = (payload: EventPayload<TEvent>) => void;

/**
 * Пользовательский listener конкретного typed system event.
 */
export type ClientSystemEventListener<
  TName extends SystemEventName = SystemEventName
> = (event: SystemEvent<TName>) => void;
