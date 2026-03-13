import test from "node:test";
import assert from "node:assert/strict";

import { connectPolicy, createContractRegistry, isRealtimeError } from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что connection policy enforcement централизован в server runtime
 * и пропускает подключение только когда все connect policy разрешают его.
 * Это важно, потому что доступ на соединение должен проверяться в одной точке,
 * а не размазываться по transport adapter и пользовательскому коду.
 * Также покрывается corner case с несколькими policy подряд, чтобы runtime
 * соблюдал детерминированный порядок исполнения connect policy.
 */
test("should authorize connections through registered connect policies", async () => {
  const calls: string[] = [];
  const isAuthenticated = connectPolicy("is-authenticated", {
    evaluate: ({ context }: { context: { authenticated: boolean } }) => {
      calls.push("is-authenticated");
      return context.authenticated;
    }
  });
  const isNotBanned = connectPolicy("is-not-banned", {
    evaluate: ({ context }: { context: { banned: boolean } }) => {
      calls.push("is-not-banned");
      return !context.banned;
    }
  });
  const runtime = createServerRuntime<
    { authenticated: boolean; banned: boolean }
  >({
    registry: createContractRegistry(),
    connectionPolicies: [isAuthenticated, isNotBanned]
  });

  await assert.doesNotReject(() =>
    runtime.authorizeConnection({
      context: {
        authenticated: true,
        banned: false
      }
    })
  );

  assert.deepEqual(calls, ["is-authenticated", "is-not-banned"]);
});

/**
 * Проверяет, что connection policy enforcement использует `connection-denied`
 * как дефолтный deny code и уважает explicit deny decision из policy.
 * Это важно, потому что policy layer должен различать "обычный deny" и
 * осознанный отказ с конкретным официальным error code и сообщением.
 * Также покрываются corner cases с boolean `false` и `unauthorized` decision,
 * чтобы runtime одинаково корректно работал с обоими сценариями.
 */
test("should normalize connection policy denials with default and explicit codes", async () => {
  const denyByDefault = createServerRuntime({
    registry: createContractRegistry(),
    connectionPolicies: [
      connectPolicy("maintenance-mode", {
        evaluate: () => false
      })
    ]
  });
  const denyExplicitly = createServerRuntime({
    registry: createContractRegistry(),
    connectionPolicies: [
      connectPolicy("requires-auth", {
        evaluate: () => ({
          allowed: false as const,
          code: "unauthorized" as const,
          message: "Authentication is required."
        })
      })
    ]
  });

  await assert.rejects(
    () =>
      denyByDefault.authorizeConnection({
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "connection-denied");
      assert.equal(
        error.message,
        'Connection is denied by policy: "maintenance-mode".'
      );
      return true;
    }
  );

  await assert.rejects(
    () =>
      denyExplicitly.authorizeConnection({
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "unauthorized");
      assert.equal(error.message, "Authentication is required.");
      return true;
    }
  );
});

/**
 * Проверяет, что runtime-исключение внутри connect policy не протекает наружу
 * сырым Error-объектом и нормализуется как internal-error.
 * Это важно, потому что даже ошибка самой policy должна оставаться в общей
 * error model и не ломать предсказуемость connection flow.
 * Также покрывается corner case с сохранением имени policy в details, чтобы
 * downstream-слой понимал, на каком именно правиле всё упало.
 */
test("should normalize connection policy failures into internal errors", async () => {
  const runtime = createServerRuntime({
    registry: createContractRegistry(),
    connectionPolicies: [
      connectPolicy("unstable-connection-policy", {
        evaluate: () => {
          throw new Error("Auth backend is offline.");
        }
      })
    ]
  });

  await assert.rejects(
    () =>
      runtime.authorizeConnection({
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        policyName: "unstable-connection-policy",
        stage: "connect"
      });
      return true;
    }
  );
});
