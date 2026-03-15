import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  createContractRegistry,
  event,
  isRealtimeError
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  eventApplier,
  type ClientTransportEventReceiver
} from "../src/index.ts";

/**
 * Проверяет, что event applier registration идет по event contract и
 * интегрируется с текущим inbound event flow client runtime.
 * Это важно, потому что event-to-state слой должен быть повторяемым и не
 * строиться на ручных строковых listener-ах и ad-hoc обновлениях UI state.
 * Также покрывается corner case с порядком стадий: applier должен успевать
 * обновить state до пользовательского listener-а того же события.
 */
test("should register event appliers and apply state updates before listeners", () => {
  let receiver: ClientTransportEventReceiver | undefined;
  let state = {
    messages: [] as string[]
  };
  const seenStates: string[][] = [];
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().trim().min(1)
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      events: [messageCreated] as const
    }),
    transport: {
      bindEvents(nextReceiver) {
        receiver = nextReceiver;
      }
    }
  });
  const stopApplying = runtime.registerEventApplier(
    eventApplier(
      messageCreated,
      (currentState: { messages: string[] }, payload) => ({
      messages: [...currentState.messages, payload.text]
      })
    ),
    {
      getState: () => state,
      setState: (nextState: { messages: string[] }) => {
        state = nextState;
      }
    }
  );

  runtime.onEvent("message-created", () => {
    seenStates.push([...state.messages]);
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: "  first  "
    },
    route: {
      target: "direct"
    }
  });

  stopApplying();

  receiver?.({
    name: "message-created",
    payload: {
      text: "second"
    },
    route: {
      target: "direct"
    }
  });

  assert.deepEqual(state, {
    messages: ["first"]
  });
  assert.deepEqual(seenStates, [["first"], ["first"]]);
});

/**
 * Проверяет, что ошибка внутри зарегистрированного event applier не ломает
 * весь inbound event flow и репортится через общий client error hook.
 * Это важно, потому что event-to-state слой должен оставаться наблюдаемым и
 * не должен тихо терять сбои внутри пользовательских state transitions.
 * Также покрывается corner case с пользовательским listener-ом, чтобы даже при
 * сбое applier-а validated payload все равно доходил до обычного event listener.
 */
test("should report event applier failures without breaking event listeners", () => {
  let receiver: ClientTransportEventReceiver | undefined;
  const capturedErrors: unknown[] = [];
  let listenerCalled = false;
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      events: [messageCreated] as const
    }),
    onError(error) {
      capturedErrors.push(error);
    },
    transport: {
      bindEvents(nextReceiver) {
        receiver = nextReceiver;
      }
    }
  });

  runtime.registerEventApplier(
    eventApplier(messageCreated, (_state: { messages: string[] }) => {
      throw new Error("Reducer crashed.");
    }),
    {
      getState: () => ({ messages: [] as string[] }),
      setState: () => undefined
    }
  );
  runtime.onEvent("message-created", () => {
    listenerCalled = true;
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: "hello"
    },
    route: {
      target: "direct"
    }
  });

  assert.equal(listenerCalled, true);
  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.deepEqual((capturedErrors[0] as { details: unknown }).details, {
    eventName: "message-created",
    stage: "apply"
  });
});
