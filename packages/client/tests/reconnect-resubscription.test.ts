import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  createContractRegistry,
  isRealtimeError
} from "@liverail/contracts";
import {
  createClientRuntime,
  type ClientTransportConnectionReceiver
} from "../src/index.ts";

/**
 * Проверяет, что client runtime хранит subscription state отдельно от текущей
 * transport session и автоматически повторяет подписки после reconnect.
 * Это важно, потому что при нестабильной сети клиент не должен терять active
 * subscriptions и перекладывать их восстановление на пользовательский код.
 * Также покрывается corner case с unsubscribe до reconnect, чтобы runtime
 * восстанавливал только актуальные подписки, а не устаревшее состояние.
 */
test("should restore active channel subscriptions after reconnect", async () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const calls: string[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      },
      async subscribeChannel(request) {
        calls.push(`subscribe:${request.name}:${JSON.stringify(request.key)}`);
      },
      async unsubscribeChannel(request) {
        calls.push(`unsubscribe:${request.name}:${JSON.stringify(request.key)}`);
      }
    }
  });

  await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });
  await runtime.subscribeChannel("voice-room", {
    roomId: "room-2"
  });
  await runtime.unsubscribeChannel("voice-room", {
    roomId: "room-2"
  });

  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "connected"
  });

  assert.deepEqual(calls, [
    'subscribe:voice-room:{"roomId":"room-1"}',
    'subscribe:voice-room:{"roomId":"room-2"}',
    'unsubscribe:voice-room:{"roomId":"room-2"}',
    'subscribe:voice-room:{"roomId":"room-1"}'
  ]);
});

/**
 * Проверяет, что неуспешная автопереподписка после reconnect не оставляет
 * ложное локальное состояние "подписка активна", а переводит этот случай в
 * наблюдаемый failure через error hook и system event `join_failed`.
 * Это важно, потому что именно рассинхронизация между клиентским runtime и
 * сервером делала старую реализацию небезопасной: UI видел active subscription,
 * хотя сервер мог уже не восстановить membership. Также покрывается corner case
 * с raw Error, чтобы runtime нормализовал transport-сбой в официальный
 * realtime error shape со stage `resubscribe` и больше не пытался повторно
 * восстанавливать уже проваленную подписку на следующих reconnect.
 */
test("should clear failed resubscriptions from runtime state and report them through error and system hooks", async () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const capturedErrors: unknown[] = [];
  const joinFailures: string[] = [];
  let subscribeCallCount = 0;
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    onError(error) {
      capturedErrors.push(error);
    },
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      },
      async subscribeChannel() {
        subscribeCallCount += 1;

        if (subscribeCallCount > 1) {
          throw new Error("Socket reconnect failed.");
        }
      },
      async unsubscribeChannel() {
        return undefined;
      }
    }
  });

  runtime.onSystemEvent("join_failed", (event) => {
    joinFailures.push(
      `${event.payload.channelName}:${String((event.payload.key as { roomId: string }).roomId)}:${event.payload.error.code}`
    );
  });

  await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });

  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "connected"
  });
  await Promise.resolve();

  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.deepEqual((capturedErrors[0] as { details: unknown }).details, {
    channelName: "voice-room",
    stage: "resubscribe"
  });
  assert.deepEqual(joinFailures, [
    "voice-room:room-1:internal-error"
  ]);
  assert.deepEqual(runtime.inspectRuntime().activeSubscriptions, []);

  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "connected"
  });
  await Promise.resolve();

  assert.equal(subscribeCallCount, 2);
});
