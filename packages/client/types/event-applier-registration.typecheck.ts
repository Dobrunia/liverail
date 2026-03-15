import { z } from "zod";

import {
  createContractRegistry,
  event
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  eventApplier,
  type ClientStateStore
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что event applier registration идет по event
 * contract и сохраняет точный тип состояния без привязки к store library.
 * Это важно, потому что registration слой должен связывать typed event и
 * typed state transition, а не сваливаться в строковые имена и `unknown`.
 * Также покрывается corner case с cleanup callback, чтобы регистрация была
 * детерминированной и снималась явной функцией без скрытой магии.
 */
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string()
  })
});
const otherEvent = event("other-event", {
  payload: z.void()
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    events: [messageCreated] as const
  })
});
const stateStore: ClientStateStore<{ messages: string[] }> = {
  getState: () => ({
    messages: []
  }),
  setState: (nextState) => {
    nextState.messages;
  }
};
const stopApplying = runtime.registerEventApplier(
  eventApplier(messageCreated, (state: { messages: string[] }, payload) => ({
    messages: [...state.messages, payload.text]
  })),
  stateStore
);

type ShouldReturnApplierCleanup = Assert<
  IsEqual<typeof stopApplying, () => void>
>;

runtime.registerEventApplier(
  // @ts-expect-error event applier registration must reject contracts outside the runtime registry
  eventApplier(otherEvent, (state: { messages: string[] }) => state),
  stateStore
);

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
