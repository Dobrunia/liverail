import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  createContractRegistry,
  event,
  isRealtimeError
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет полный happy path event pipeline: payload сначала валидируется,
 * затем проходит route stage и только после этого доставляется deliverer-ом.
 * Это важно, потому что server push должен быть централизованным и контрактным,
 * а не размываться по raw event names и произвольным payload-объектам.
 * Также покрывается corner case с несколькими route-результатами, чтобы
 * один emit мог детерминированно порождать несколько delivery-операций.
 */
test("should emit events through validate route and deliver stages", async () => {
  const stages: string[] = [];
  const deliveries: string[] = [];
  const memberJoined = event("member-joined", {
    payload: z.object({
      roomId: z.string().trim().min(1),
      joinedAt: z.coerce.date()
    })
  });
  const registry = createContractRegistry({
    events: [memberJoined] as const
  });
  const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
    registry,
    eventRouters: {
      "member-joined": ({ payload, context }) => {
        stages.push("route");
        assert.equal(payload.roomId, "room-1");
        assert.deepEqual(payload.joinedAt, new Date("2026-03-13T12:00:00.000Z"));
        assert.equal(context.requestId, "req-1");

        return [
          {
            target: "room:room-1"
          },
          {
            target: "audit-log"
          }
        ] as const;
      }
    },
    eventDeliverers: {
      "member-joined": ({ route, payload }) => {
        stages.push("deliver");
        deliveries.push(route.target);
        assert.equal(payload.roomId, "room-1");
      }
    }
  });

  const emitted = await runtime.emitEvent(
    "member-joined",
    {
      roomId: "  room-1  ",
      joinedAt: "2026-03-13T12:00:00.000Z"
    },
    {
      context: {
        requestId: "req-1"
      }
    }
  );

  assert.deepEqual(
    emitted.map((entry) => entry.route.target),
    ["room:room-1", "audit-log"]
  );
  assert.deepEqual(deliveries, ["room:room-1", "audit-log"]);
  assert.deepEqual(stages, ["route", "deliver", "deliver"]);
});

/**
 * Проверяет, что невалидный event payload обрывает pipeline до route и deliver
 * и наружу уходит уже нормализованная realtime validation error.
 * Это важно, потому что event emission не должен допускать сырые невалидные
 * payload-объекты до маршрутизации и transport layer.
 * Также покрывается corner case с флагами вызова, чтобы гарантировать:
 * invalid payload вообще не добирается до route/deliver этапов.
 */
test("should stop event emission on invalid payload before route and deliver", async () => {
  let routeCalled = false;
  let deliverCalled = false;
  const memberJoined = event("member-joined", {
    payload: z.object({
      joinedAt: z.coerce.date()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      events: [memberJoined] as const
    }),
    eventRouters: {
      "member-joined": () => {
        routeCalled = true;
        return [];
      }
    },
    eventDeliverers: {
      "member-joined": () => {
        deliverCalled = true;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.emitEvent(
        "member-joined",
        {
          joinedAt: "not-a-date"
        },
        {
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-event-payload");
      return true;
    }
  );

  assert.equal(routeCalled, false);
  assert.equal(deliverCalled, false);
});

/**
 * Проверяет, что route и deliver стадии не протаскивают наружу сырые runtime
 * исключения, а нормализуют их в стабильный realtime error shape.
 * Это важно, потому что emission pipeline должен быть предсказуемым не только
 * на happy path, но и при сбоях маршрутизации и доставки.
 * Также покрываются corner cases отдельно для stage `route` и `deliver`,
 * чтобы следующему слою было видно, на каком этапе упал emit.
 */
test("should normalize route and deliver failures in the event pipeline", async () => {
  const routeBroken = event("route-broken", {
    payload: z.void()
  });
  const deliverBroken = event("deliver-broken", {
    payload: z.void()
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      events: [routeBroken, deliverBroken] as const
    }),
    eventRouters: {
      "route-broken": () => {
        throw new Error("Route lookup failed.");
      },
      "deliver-broken": () => ({
        target: "room:room-1"
      })
    },
    eventDeliverers: {
      "route-broken": () => {},
      "deliver-broken": ({ name }) => {
        if (name === "deliver-broken") {
          throw new Error("Socket adapter is offline.");
        }
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.emitEvent("route-broken", undefined, {
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        eventName: "route-broken",
        stage: "route"
      });
      return true;
    }
  );

  await assert.rejects(
    () =>
      runtime.emitEvent("deliver-broken", undefined, {
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        eventName: "deliver-broken",
        stage: "deliver"
      });
      return true;
    }
  );
});
