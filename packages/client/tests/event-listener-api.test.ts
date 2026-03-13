import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  createContractRegistry,
  event,
  isRealtimeError
} from "@liverail/contracts";
import {
  createClientRuntime,
  type ClientTransportEventReceiver
} from "../src/index.ts";

/**
 * Проверяет happy path typed event listener API: transport передает сырое
 * событие, runtime валидирует payload по contract definition и только потом
 * вызывает пользовательский listener с уже нормализованными данными.
 * Это важно, потому что client runtime должен заменять raw listener-ы
 * контрактным потреблением событий без ручной валидации на экране.
 * Также покрывается corner case с cleanup-функцией listener-а, чтобы после
 * unsubscribe входящее событие больше не попадало в пользовательский код.
 */
test("should deliver validated inbound events to typed client listeners", () => {
  let receiver: ClientTransportEventReceiver | undefined;
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
  const receivedPayloads: string[] = [];
  const stopListening = runtime.onEvent("message-created", (payload) => {
    receivedPayloads.push(payload.text);
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: "  hello  "
    }
  });

  stopListening();

  receiver?.({
    name: "message-created",
    payload: {
      text: "ignored"
    }
  });

  assert.deepEqual(receivedPayloads, ["hello"]);
});

/**
 * Проверяет, что invalid inbound event payload нормализуется до официального
 * realtime error shape и не доходит до пользовательского listener-а.
 * Это важно, потому что клиент не должен потреблять невалидные события даже
 * если transport прислал их в неправильной форме или с испорченным payload.
 * Также покрывается corner case с error hook, чтобы downstream-слой мог
 * централизованно наблюдать invalid inbound events без raw Zod-ошибок.
 */
test("should normalize invalid inbound event payloads before user listeners", () => {
  let receiver: ClientTransportEventReceiver | undefined;
  let listenerCalled = false;
  const capturedErrors: unknown[] = [];
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().min(1)
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

  runtime.onEvent("message-created", () => {
    listenerCalled = true;
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: 42
    }
  });

  assert.equal(listenerCalled, false);
  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.equal(
    (capturedErrors[0] as { code: string }).code,
    "invalid-event-payload"
  );
});
