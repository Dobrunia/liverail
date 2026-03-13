import test from "node:test";
import assert from "node:assert/strict";

import {
  andPolicy,
  commandPolicy,
  connectPolicy,
  joinPolicy,
  notPolicy,
  orPolicy
} from "../src/index.ts";

/**
 * Проверяет, что combinator-функции `and/or/not` композиционно собирают policy
 * без потери scope и с ожидаемой short-circuit логикой.
 * Это важно, потому что policy layer должен позволять собирать сложные правила
 * из простых без копипасты и без изобретения отдельного DSL.
 * Также покрываются corner cases с explicit deny decision и инверсией правила,
 * чтобы композиция одинаково работала и для boolean, и для deny-объектов.
 */
test("should compose scoped policies through and or and not helpers", async () => {
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
  const isMaintenanceDisabled = connectPolicy("is-maintenance-disabled", {
    evaluate: () => {
      calls.push("is-maintenance-disabled");
      return {
        allowed: false as const,
        code: "connection-denied" as const,
        message: "Maintenance mode."
      };
    }
  });

  const canConnect = andPolicy("can-connect", [isAuthenticated, isNotBanned]);
  const canConnectDuringBypass = orPolicy("can-connect-during-bypass", [
    canConnect,
    isMaintenanceDisabled
  ]);
  const isAnonymous = notPolicy("is-anonymous", isAuthenticated);

  assert.equal(canConnect.scope, "connect");
  assert.equal(
    await canConnect.evaluate({
      context: {
        authenticated: true,
        banned: false
      }
    }),
    true
  );

  calls.length = 0;
  assert.deepEqual(
    await canConnectDuringBypass.evaluate({
      context: {
        authenticated: false,
        banned: false
      }
    }),
    {
      allowed: false,
      code: "connection-denied",
      message: "Maintenance mode."
    }
  );
  assert.deepEqual(calls, [
    "is-authenticated",
    "is-maintenance-disabled"
  ]);

  assert.equal(
    await isAnonymous.evaluate({
      context: {
        authenticated: false
      }
    }),
    true
  );
});

/**
 * Проверяет, что composition helpers отклоняют пустую композицию и смешивание
 * policy с разными scope.
 * Это важно, потому что `and/or/not` должны оставаться маленькими, но при этом
 * не позволять собирать бессмысленные или архитектурно некорректные комбинации.
 * Также покрывается corner case с connect/join policy, чтобы ошибка возникала
 * сразу в момент объявления composition, а не позже в runtime enforcement.
 */
test("should reject empty compositions and mismatched policy scopes", () => {
  const canConnect = connectPolicy("can-connect", {
    evaluate: () => true
  });
  const canJoin = joinPolicy("can-join", {
    evaluate: () => true
  });

  assert.throws(
    () =>
      andPolicy("invalid-and", [] as never),
    {
      name: "TypeError",
      message: "Policy composition requires at least one policy."
    }
  );

  assert.throws(
    () =>
      orPolicy("invalid-or", [canConnect, canJoin] as never),
    {
      name: "TypeError",
      message: 'Policy composition requires the same scope for all policies, received "connect" and "join".'
    }
  );

  assert.throws(
    () =>
      notPolicy("invalid-not", canJoin, {
        scope: "connect"
      } as never),
    {
      name: "TypeError",
      message: 'Policy composition scope override must match the source policy scope, received "connect" and "join".'
    }
  );
});
