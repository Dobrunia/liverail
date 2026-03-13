import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry,
  event
} from "@liverail/contracts";
import {
  createClientRuntime,
  eventApplier,
  type ClientTransportEventReceiver
} from "../src/index.ts";

/**
 * Проверяет, что client runtime публикует read-only debug snapshot с текущим
 * operational-состоянием: активные подписки, listeners, appliers и состояние
 * самого runtime. Это важно, потому что без такой утилиты client runtime
 * сложно отлаживать в UI и LLM-driven окружении.
 * Также покрывается corner case со сменой состояния после `destroy`, чтобы
 * debug utility отражал lifecycle runtime и после очистки ресурсов.
 */
test("should expose a read-only client runtime debug snapshot", async () => {
  let receiver: ClientTransportEventReceiver | undefined;
  const globalChannel = channel("global", {
    key: z.object({
      roomId: z.string()
    })
  });
  const heartbeat = event("heartbeat", {
    payload: z.object({
      value: z.number()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [globalChannel] as const,
      events: [heartbeat] as const
    }),
    transport: {
      async subscribeChannel() {
        return undefined;
      },
      bindEvents(nextReceiver) {
        receiver = nextReceiver;
      }
    }
  });

  runtime.onEvent("heartbeat", () => undefined);
  runtime.registerEventApplier(
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
  await runtime.subscribeChannel("global", {
    roomId: "room-1"
  });

  receiver?.({
    name: "heartbeat",
    payload: {
      value: 1
    },
    route: {
      target: "direct"
    }
  });

  const activeSnapshot = runtime.inspectRuntime();

  assert.equal(Object.isFrozen(activeSnapshot), true);
  assert.equal(activeSnapshot.state, "active");
  assert.equal(activeSnapshot.transportBound, true);
  assert.deepEqual(activeSnapshot.contracts.channels.names, ["global"]);
  assert.deepEqual(activeSnapshot.activeSubscriptions, [
    {
      contract: globalChannel,
      name: "global",
      key: {
        roomId: "room-1"
      },
      id: 'global:{"roomId":"room-1"}'
    }
  ]);
  assert.deepEqual(activeSnapshot.eventListenerNames, ["heartbeat"]);
  assert.deepEqual(activeSnapshot.eventListenerCounts, {
    heartbeat: 1
  });
  assert.deepEqual(activeSnapshot.eventApplierNames, ["heartbeat"]);

  runtime.destroy();

  const destroyedSnapshot = runtime.inspectRuntime();

  assert.equal(destroyedSnapshot.state, "destroyed");
  assert.deepEqual(destroyedSnapshot.activeSubscriptions, []);
  assert.deepEqual(destroyedSnapshot.eventListenerNames, []);
  assert.deepEqual(destroyedSnapshot.eventApplierNames, []);
});
