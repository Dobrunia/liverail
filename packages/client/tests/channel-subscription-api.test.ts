import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  createContractRegistry,
  createRealtimeError,
  isRealtimeError
} from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.ts";

/**
 * Проверяет happy path typed channel subscription API: key валидируется до
 * transport-вызова, transport получает уже нормализованный key, а runtime
 * хранит локальное subscription state для корректного unsubscribe.
 * Это важно, потому что клиентский слой подписок не должен быть набором строк
 * и должен работать через channel contract, а не через raw room names.
 * Также покрывается corner case с повторным unsubscribe, чтобы локальное
 * subscription state оставалось детерминированным и идемпотентным.
 */
test("should subscribe and unsubscribe channels through typed contracts", async () => {
  const calls: string[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel(request) {
        calls.push(`subscribe:${request.name}:${JSON.stringify(request.key)}`);
      },
      async unsubscribeChannel(request) {
        calls.push(`unsubscribe:${request.name}:${JSON.stringify(request.key)}`);
      }
    }
  });

  const subscription = await runtime.subscribeChannel("voice-room", {
    roomId: "  room-1  "
  });
  const firstUnsubscribe = await runtime.unsubscribeChannel("voice-room", {
    roomId: "room-1"
  });
  const secondUnsubscribe = await runtime.unsubscribeChannel("voice-room", {
    roomId: "room-1"
  });

  assert.deepEqual(subscription, {
    contract: voiceRoom,
    name: "voice-room",
    key: {
      roomId: "room-1"
    },
    id: 'voice-room:{"roomId":"room-1"}'
  });
  assert.equal(firstUnsubscribe, true);
  assert.equal(secondUnsubscribe, false);
  assert.deepEqual(calls, [
    'subscribe:voice-room:{"roomId":"room-1"}',
    'unsubscribe:voice-room:{"roomId":"room-1"}'
  ]);
});

/**
 * Проверяет, что невалидный channel key обрывает subscribe до transport-а.
 * Это важно, потому что адресация подписок должна оставаться контрактной и
 * не должна выпускать невалидные room keys в transport слой.
 * Также покрывается corner case с флагом вызова transport, чтобы гарантировать:
 * invalid key не отправляется в сеть даже при наличии transport adapter.
 */
test("should stop channel subscriptions on invalid keys before the transport call", async () => {
  let transportCalled = false;
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().uuid()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        transportCalled = true;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.subscribeChannel("voice-room", {
        roomId: "room-1"
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-channel-key");
      return true;
    }
  );

  assert.equal(transportCalled, false);
});

/**
 * Проверяет, что transport-level subscribe failures не протекают наружу сырыми
 * ошибками: realtime error сохраняется, а raw Error нормализуется.
 * Это важно, потому что клиентский subscription API должен уважать официальный
 * `join-denied`, но при этом не выносить наружу необработанные transport ошибки.
 * Также покрывается corner case с realtime error и raw Error, чтобы различать
 * бизнес-отказ join-а и внутреннюю транспортную неисправность.
 */
test("should normalize channel subscription transport failures", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const joinDenied = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        throw createRealtimeError({
          code: "join-denied",
          message: "Private room."
        });
      }
    }
  });
  const brokenTransport = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        throw new Error("Socket disconnected.");
      }
    }
  });

  await assert.rejects(
    () =>
      joinDenied.subscribeChannel("voice-room", {
        roomId: "room-1"
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "join-denied");
      assert.equal(error.message, "Private room.");
      return true;
    }
  );

  await assert.rejects(
    () =>
      brokenTransport.subscribeChannel("voice-room", {
        roomId: "room-1"
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        channelName: "voice-room",
        stage: "subscribe"
      });
      return true;
    }
  );
});
