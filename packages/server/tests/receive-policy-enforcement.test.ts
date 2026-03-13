import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  createContractRegistry,
  event,
  isRealtimeError,
  receivePolicy
} from "@liverail/contracts";
import {
  createServerRuntime,
  type ServerEventRoute
} from "../src/index.ts";

/**
 * Проверяет, что receive policy enforcement исполняется для каждой route-записи
 * после routing и до фактической delivery-стадии.
 * Это важно, потому что join в канал и право получить конкретное событие
 * должны различаться, а утечка события не должна зависеть от deliverer-а.
 * Также покрывается corner case с несколькими route, чтобы deny одной цели
 * не мешал разрешенной доставке другой цели и не ломал порядок стадий.
 */
test("should filter event deliveries through registered receive policies", async () => {
  const stages: string[] = [];
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().trim().min(1)
    })
  });
  const registry = createContractRegistry({
    events: [messageCreated] as const
  });
  const canReceiveMessageCreated = receivePolicy<
    "can-receive-message-created",
    typeof messageCreated,
    { blockedTargets: readonly string[] },
    ServerEventRoute
  >("can-receive-message-created", {
    evaluate: ({ payload, route, context }) => {
      stages.push(`policy:${route.target}`);
      assert.equal(payload.text, "hello");
      return !context.blockedTargets.includes(route.target);
    }
  });
  const runtime = createServerRuntime<
    { blockedTargets: readonly string[] },
    typeof registry
  >({
    registry,
    eventReceivePolicies: {
      "message-created": [canReceiveMessageCreated]
    },
    eventRouters: {
      "message-created": () => [
        {
          target: "socket-1"
        },
        {
          target: "socket-2"
        }
      ]
    },
    eventDeliverers: {
      "message-created": ({ route }) => {
        stages.push(`deliver:${route.target}`);
      }
    }
  });

  const deliveries = await runtime.emitEvent(
    "message-created",
    {
      text: "  hello  "
    },
    {
      context: {
        blockedTargets: ["socket-2"]
      }
    }
  );

  assert.deepEqual(
    deliveries.map((delivery) => delivery.route.target),
    ["socket-1"]
  );
  assert.deepEqual(stages, [
    "policy:socket-1",
    "deliver:socket-1",
    "policy:socket-2"
  ]);
});

/**
 * Проверяет, что receive policy deny в boolean и explicit-form вариантах
 * не роняет весь emit, а просто отфильтровывает запрещенные delivery.
 * Это важно, потому что receive layer защищает отдельных получателей и не
 * должен превращать частичный deny в глобальную ошибку эмиссии.
 * Также покрывается corner case с несколькими policy подряд, чтобы route
 * удалялась из delivery-потока при первом deny независимо от формы решения.
 */
test("should skip denied deliveries for boolean and explicit receive policy results", async () => {
  const deliveredTargets: string[] = [];
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      events: [messageCreated] as const
    }),
    eventReceivePolicies: {
      "message-created": [
        receivePolicy<
          "is-not-blocked",
          typeof messageCreated,
          unknown,
          ServerEventRoute
        >("is-not-blocked", {
          evaluate: ({ route }) => route.target !== "socket-2"
        }),
        receivePolicy<
          "can-receive-message-created",
          typeof messageCreated,
          unknown,
          ServerEventRoute
        >("can-receive-message-created", {
          evaluate: ({ route }) =>
            route.target === "socket-3"
              ? {
                  allowed: false as const,
                  code: "forbidden" as const,
                  message: "Target cannot receive this event."
                }
              : true
        })
      ]
    },
    eventRouters: {
      "message-created": () => [
        {
          target: "socket-1"
        },
        {
          target: "socket-2"
        },
        {
          target: "socket-3"
        }
      ]
    },
    eventDeliverers: {
      "message-created": ({ route }) => {
        deliveredTargets.push(route.target);
      }
    }
  });

  const deliveries = await runtime.emitEvent(
    "message-created",
    {
      text: "hello"
    },
    {
      context: {}
    }
  );

  assert.deepEqual(deliveredTargets, ["socket-1"]);
  assert.deepEqual(
    deliveries.map((delivery) => delivery.route.target),
    ["socket-1"]
  );
});

/**
 * Проверяет, что ошибка внутри receive policy не протекает наружу сырым
 * исключением и нормализуется как `internal-error` со stage `receive`.
 * Это важно, потому что delivery security должна пользоваться тем же error
 * model, что и остальные policy-фазы server runtime.
 * Также покрывается corner case с недоставленным событием, чтобы deliverer
 * не вызывался, если policy evaluation упала до фактической отправки.
 */
test("should normalize receive policy failures into internal errors", async () => {
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  let delivererCalled = false;
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      events: [messageCreated] as const
    }),
    eventReceivePolicies: {
      "message-created": [
        receivePolicy<
          "unstable-receive-policy",
          typeof messageCreated,
          unknown,
          ServerEventRoute
        >("unstable-receive-policy", {
          evaluate: () => {
            throw new Error("ACL backend is offline.");
          }
        })
      ]
    },
    eventRouters: {
      "message-created": () => ({
        target: "socket-1"
      })
    },
    eventDeliverers: {
      "message-created": () => {
        delivererCalled = true;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.emitEvent(
        "message-created",
        {
          text: "hello"
        },
        {
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        policyName: "unstable-receive-policy",
        stage: "receive"
      });
      return true;
    }
  );

  assert.equal(delivererCalled, false);
});
