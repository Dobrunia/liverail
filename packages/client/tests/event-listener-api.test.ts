import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
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
    },
    route: {
      target: "direct"
    }
  });

  stopListening();

  receiver?.({
    name: "message-created",
    payload: {
      text: "ignored"
    },
    route: {
      target: "direct"
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
    },
    route: {
      target: "direct"
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

/**
 * Проверяет, что client runtime больше не доверяет channel-scoped inbound
 * delivery только по имени события и дополнительно сверяет channel instance
 * с локальным subscription state.
 * Это важно, потому что после unsubscribe или state divergence transport не
 * должен иметь возможности протолкнуть channel event в пользовательский
 * listener, если активной подписки на этот channel instance уже нет.
 * Также покрывается corner case с нормализованным runtime error, чтобы такой
 * stray delivery не терялся молча и оставался наблюдаемым через error hook.
 */
test("should ignore inbound channel events that do not match an active subscription", async () => {
  let receiver: ClientTransportEventReceiver | undefined;
  const capturedErrors: unknown[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().min(1)
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [messageCreated] as const
    }),
    onError(error) {
      capturedErrors.push(error);
    },
    transport: {
      subscribeChannel() {
        return undefined;
      },
      unsubscribeChannel() {
        return undefined;
      },
      bindEvents(nextReceiver) {
        receiver = nextReceiver;
      }
    }
  });
  const receivedPayloads: string[] = [];
  const channelId = voiceRoom.of({
    roomId: "room-1"
  }).id;

  runtime.onEvent("message-created", (payload) => {
    receivedPayloads.push(payload.text);
  });

  await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: "allowed"
    },
    route: {
      target: "channel",
      channelId
    }
  });

  await runtime.unsubscribeChannel("voice-room", {
    roomId: "room-1"
  });

  receiver?.({
    name: "message-created",
    payload: {
      text: "blocked"
    },
    route: {
      target: "channel",
      channelId
    }
  });

  assert.deepEqual(receivedPayloads, ["allowed"]);
  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.equal(
    (capturedErrors[0] as { code: string }).code,
    "internal-error"
  );
});
