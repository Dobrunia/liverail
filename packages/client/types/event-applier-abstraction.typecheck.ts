import { z } from "zod";

import {
  event,
  type EventPayload
} from "@liverail/contracts";
import {
  applyEventApplier,
  eventApplier,
  type ClientEventApplierDefinition
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что event applier abstraction сохраняет точные
 * типы event payload и state без привязки к конкретному store implementation.
 * Это важно, потому что event-to-state слой должен быть универсальным, но при
 * этом не терять строгую связь с конкретным event contract.
 * Также покрывается corner case с pure helper-ом `applyEventApplier`, чтобы
 * итоговый state выводился без ручных generic-аннотаций и cast-ов.
 */
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string(),
    sentAt: z.date()
  })
});
const appendMessage = eventApplier(messageCreated, (state: { messages: string[] }, payload) => {
  type ShouldTypeApplierPayload = Assert<
    IsEqual<typeof payload, EventPayload<typeof messageCreated>>
  >;

  return {
    messages: [...state.messages, payload.text]
  };
});
const nextState = applyEventApplier(
  appendMessage,
  {
    messages: []
  },
  {
    text: "hello",
    sentAt: new Date("2026-03-13T12:00:00.000Z")
  }
);

type ShouldExposeTypedEventApplierDefinition = Assert<
  IsEqual<
    typeof appendMessage,
    ClientEventApplierDefinition<typeof messageCreated, { messages: string[] }>
  >
>;

type ShouldReturnTypedNextState = Assert<
  IsEqual<typeof nextState, { messages: string[] }>
>;

applyEventApplier(
  appendMessage,
  {
    messages: []
  },
  {
    // @ts-expect-error event applier abstraction must enforce the event payload schema
    text: 42,
    sentAt: new Date("2026-03-13T12:00:00.000Z")
  }
);

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
