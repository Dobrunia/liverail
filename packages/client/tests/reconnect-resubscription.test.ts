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
 * Проверяет, что ошибка автопереподписки после reconnect не теряет desired
 * subscription state и репортится через общий client error hook.
 * Это важно, потому что reconnect-поток должен быть наблюдаемым и не должен
 * тихо съедать transport failures при восстановлении подписок.
 * Также покрывается corner case с raw Error, чтобы runtime нормализовал его в
 * общий realtime error shape и использовал отдельный stage `resubscribe`.
 */
test("should report resubscription failures through the client error hook", async () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const capturedErrors: unknown[] = [];
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

  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "connected"
  });
  await Promise.resolve();

  assert.equal(subscribeCallCount, 3);
});
