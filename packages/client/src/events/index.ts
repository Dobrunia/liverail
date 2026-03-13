import type { EventContract, EventPayload } from "@liverail/contracts";

/**
 * Пользовательский listener конкретного typed события.
 */
export type ClientEventListener<
  TEvent extends EventContract = EventContract
> = (payload: EventPayload<TEvent>) => void;
