import { z } from "zod";

import {
  createContractRegistry,
  event,
  type EventPayload
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  type ClientTransportEvent,
  type ClientTransportEventReceiver
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что typed event listener API сохраняет точный
 * payload конкретного события и тип transport receiver не размывается.
 * Это важно, потому что клиентский event consumption должен давать
 * validated payload прямо в listener без ручных приведений типов.
 * Также покрывается corner case с cleanup-функцией, чтобы `onEvent` возвращал
 * явный unsubscribe callback для детерминированного снятия listener-а.
 */
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string(),
    sentAt: z.date()
  })
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    events: [messageCreated] as const
  }),
  transport: {
    bindEvents(receiver) {
      type ShouldTypeTransportEventReceiver = Assert<
        IsEqual<typeof receiver, ClientTransportEventReceiver>
      >;

      receiver({
        name: "message-created",
        payload: {
          text: "hello",
          sentAt: new Date("2026-03-13T12:00:00.000Z")
        },
        route: {
          target: "direct"
        }
      } satisfies ClientTransportEvent);
    }
  }
});

const stopListening = runtime.onEvent("message-created", (payload) => {
  type ShouldTypeListenerPayload = Assert<
    IsEqual<typeof payload, EventPayload<typeof messageCreated>>
  >;

  payload.text;
});

type ShouldReturnListenerCleanup = Assert<
  IsEqual<typeof stopListening, () => void>
>;

runtime.onEvent("message-created", (payload) => {
  payload.sentAt;
});

runtime.onEvent("message-created",
  // @ts-expect-error event listener API must enforce the known payload shape
  (payload: { text: number }) => {
    payload.text;
  }
);

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
