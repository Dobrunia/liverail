import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  createContractRegistry,
  isRealtimeError,
  joinPolicy
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что join policy enforcement централизован в `joinChannel`,
 * исполняется в детерминированном порядке и пропускает join только после
 * успешной проверки всех policy и последующего authorizer-хука.
 * Это важно, потому что доступ к channel instance должен жить в runtime,
 * а не размазываться по transport-слою или handler-ам команд.
 * Также покрывается corner case с комбинацией policy и authorizer, чтобы
 * новая policy-фаза не ломала уже существующую authorizer-стадию.
 */
test("should authorize channel joins through registered join policies", async () => {
  const calls: string[] = [];
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const registry = createContractRegistry({
    channels: [voiceRoom] as const
  });
  const canAccessRoom = joinPolicy<
    "can-access-room",
    typeof voiceRoom,
    { allowedRooms: readonly string[] }
  >("can-access-room", {
    evaluate: ({
      key,
      context
    }: {
      key: { roomId: string };
      context: { allowedRooms: readonly string[] };
    }) => {
      calls.push("can-access-room");
      return context.allowedRooms.includes(key.roomId);
    }
  });
  const isNotBlocked = joinPolicy<
    "is-not-blocked",
    typeof voiceRoom,
    { blocked: boolean }
  >("is-not-blocked", {
    evaluate: ({ context }: { context: { blocked: boolean } }) => {
      calls.push("is-not-blocked");
      return !context.blocked;
    }
  });
  const runtime = createServerRuntime<
    { allowedRooms: readonly string[]; blocked: boolean },
    typeof registry
  >({
    registry,
    channelJoinPolicies: {
      "voice-room": [canAccessRoom, isNotBlocked]
    },
    channelJoinAuthorizers: {
      "voice-room": () => {
        calls.push("authorizer");
        return true;
      }
    }
  });

  const membership = await runtime.joinChannel(
    "voice-room",
    {
      roomId: "  room-1  "
    },
    {
      memberId: "socket-1",
      context: {
        allowedRooms: ["room-1"],
        blocked: false
      }
    }
  );

  assert.equal(membership.key.roomId, "room-1");
  assert.deepEqual(calls, [
    "can-access-room",
    "is-not-blocked",
    "authorizer"
  ]);
});

/**
 * Проверяет, что join policy enforcement использует `join-denied` как
 * дефолтный код отказа и уважает explicit deny decision из policy.
 * Это важно, потому что join access layer должен одинаково корректно работать
 * и с простым boolean-отказом, и с осознанным deny-решением с кодом/сообщением.
 * Также покрывается corner case с остановкой до authorizer, чтобы denied join
 * не создавал membership и не проходил в следующий runtime-stage.
 */
test("should normalize join policy denials with default and explicit codes", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  let authorizerCalled = false;
  const denyByDefault = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelJoinPolicies: {
      "voice-room": [
        joinPolicy<"members-only", typeof voiceRoom>("members-only", {
          evaluate: () => false
        })
      ]
    },
    channelJoinAuthorizers: {
      "voice-room": () => {
        authorizerCalled = true;
        return true;
      }
    }
  });
  const denyExplicitly = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelJoinPolicies: {
      "voice-room": [
        joinPolicy<"requires-auth", typeof voiceRoom>("requires-auth", {
          evaluate: () => ({
            allowed: false as const,
            code: "unauthorized" as const,
            message: "Authentication is required."
          })
        })
      ]
    }
  });

  await assert.rejects(
    () =>
      denyByDefault.joinChannel(
        "voice-room",
        {
          roomId: "room-1"
        },
        {
          memberId: "socket-1",
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "join-denied");
      assert.equal(
        error.message,
        'Channel join is denied by policy: "members-only".'
      );
      return true;
    }
  );

  assert.equal(authorizerCalled, false);

  await assert.rejects(
    () =>
      denyExplicitly.joinChannel(
        "voice-room",
        {
          roomId: "room-1"
        },
        {
          memberId: "socket-1",
          context: {}
        }
      ),
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
 * Проверяет, что исключение внутри join policy не протекает наружу сырым
 * Error-объектом и нормализуется как `internal-error` со stage `join`.
 * Это важно, потому что ошибка самой policy не должна ломать единый error model
 * и должна оставаться диагностируемой для transport/runtime слоя.
 * Также покрывается corner case с сохранением имени policy в details, чтобы
 * downstream-слой мог понять, на каком именно правиле произошел сбой.
 */
test("should normalize join policy failures into internal errors", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelJoinPolicies: {
      "voice-room": [
        joinPolicy<"unstable-join-policy", typeof voiceRoom>(
          "unstable-join-policy",
          {
          evaluate: () => {
            throw new Error("Presence backend is offline.");
          }
          }
        )
      ]
    }
  });

  await assert.rejects(
    () =>
      runtime.joinChannel(
        "voice-room",
        {
          roomId: "room-1"
        },
        {
          memberId: "socket-1",
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        policyName: "unstable-join-policy",
        stage: "join"
      });
      return true;
    }
  );
});
