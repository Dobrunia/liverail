import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry,
  event
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  eventApplier
} from "../src/index.ts";

/**
 * Проверяет, что client runtime при `destroy()` предсказуемо снимает active
 * channel subscriptions, отвязывает transport receivers и очищает listeners.
 * Это важно, потому что ручной destroy должен быть официальной точкой cleanup,
 * а не оставлять висящие подписки и локальные runtime-записи после завершения.
 * Также покрывается corner case с ранее выданными cleanup-функциями, чтобы их
 * можно было безопасно вызывать и после destroy без повторных побочных эффектов.
 */
test("should cleanup client subscriptions listeners and transport bindings during destroy", async () => {
  const calls: string[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const heartbeat = event("heartbeat", {
    payload: z.object({
      value: z.number()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [heartbeat] as const
    }),
    transport: {
      async subscribeChannel(request) {
        calls.push(`subscribe:${request.name}:${JSON.stringify(request.key)}`);
      },
      async unsubscribeChannel(request) {
        calls.push(`unsubscribe:${request.name}:${JSON.stringify(request.key)}`);
      },
      bindConnection() {
        calls.push("bind-connection");
        return () => {
          calls.push("unbind-connection");
        };
      },
      bindEvents() {
        calls.push("bind-events");
        return () => {
          calls.push("unbind-events");
        };
      },
      dispose() {
        calls.push("dispose-transport");
      }
    }
  });
  const stopEvent = runtime.onEvent("heartbeat", () => undefined);
  const stopSystemEvent = runtime.onSystemEvent("connected", () => undefined);
  const stopApplier = runtime.registerEventApplier(
    eventApplier(heartbeat, (state: { value: number }, payload) => ({
      value: state.value + payload.value
    })),
    {
      getState() {
        return {
          value: 0
        };
      },
      setState() {
        return undefined;
      }
    }
  );

  await runtime.subscribeChannel("voice-room", {
    roomId: " room-1 "
  });

  runtime.destroy();
  stopEvent();
  stopSystemEvent();
  stopApplier();

  const snapshot = runtime.inspectRuntime();

  assert.deepEqual(snapshot.activeSubscriptions, []);
  assert.deepEqual(snapshot.eventListenerNames, []);
  assert.deepEqual(snapshot.eventApplierNames, []);
  assert.deepEqual(calls, [
    "bind-connection",
    "bind-events",
    'subscribe:voice-room:{"roomId":"room-1"}',
    'unsubscribe:voice-room:{"roomId":"room-1"}',
    "unbind-connection",
    "unbind-events",
    "dispose-transport"
  ]);
});
