import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  command,
  commandPolicy,
  createContractRegistry,
  isRealtimeError
} from "dobrunia-liverail-contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что command policy enforcement встроен в `executeCommand`,
 * исполняется после input validation и до authorizer/handler.
 * Это важно, потому что доступ к команде должен проверяться централизованно
 * и не размазываться по business-логике конкретного handler-а.
 * Также покрывается corner case с coexistence policy и authorizer, чтобы
 * новая policy-фаза не ломала уже существующий command pipeline.
 */
test("should authorize commands through registered command policies", async () => {
  const stages: string[] = [];
  const setVolume = command("set-volume", {
    input: z.object({
      roomId: z.string(),
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.object({
      appliedLevel: z.number().int().min(0).max(100)
    })
  });
  const registry = createContractRegistry({
    commands: [setVolume] as const
  });
  const isModerator = commandPolicy<
    "is-moderator",
    typeof setVolume,
    { role: "admin" | "user" }
  >("is-moderator", {
    evaluate: ({ context, input }) => {
      stages.push("is-moderator");
      assert.equal(input.level, 42);
      return context.role === "admin";
    }
  });
  const isRoomEditable = commandPolicy<
    "is-room-editable",
    typeof setVolume,
    { lockedRooms: readonly string[] }
  >("is-room-editable", {
    evaluate: ({ context, input }) => {
      stages.push("is-room-editable");
      return !context.lockedRooms.includes(input.roomId);
    }
  });
  const runtime = createServerRuntime<
    { role: "admin" | "user"; lockedRooms: readonly string[]; requestId: string },
    typeof registry
  >({
    registry,
    commandPolicies: {
      "set-volume": [isModerator, isRoomEditable]
    },
    commandAuthorizers: {
      "set-volume": ({ context }) => {
        stages.push("authorizer");
        return context.requestId === "req-1";
      }
    },
    commandHandlers: {
      "set-volume": ({ input }) => {
        stages.push("handle");
        return {
          appliedLevel: input.level
        };
      }
    }
  });

  const ack = await runtime.executeCommand(
    "set-volume",
    {
      roomId: "room-1",
      level: "42"
    },
    {
      context: {
        role: "admin",
        lockedRooms: [],
        requestId: "req-1"
      }
    }
  );

  assert.deepEqual(stages, [
    "is-moderator",
    "is-room-editable",
    "authorizer",
    "handle"
  ]);
  assert.deepEqual(ack, {
    appliedLevel: 42
  });
});

/**
 * Проверяет, что command policy enforcement использует `forbidden` как
 * дефолтный deny code и уважает explicit deny decision из policy.
 * Это важно, потому что команда может быть запрещена как общим правилом,
 * так и явным security-решением с более точным кодом `unauthorized`.
 * Также покрывается corner case с остановкой до authorizer и handler, чтобы
 * denied command не проходила глубже в pipeline.
 */
test("should normalize command policy denials with default and explicit codes", async () => {
  const kickUser = command("kick-user", {
    input: z.object({
      userId: z.string()
    }),
    ack: z.void()
  });
  let authorizerCalled = false;
  let handlerCalled = false;
  const denyByDefault = createServerRuntime({
    registry: createContractRegistry({
      commands: [kickUser] as const
    }),
    commandPolicies: {
      "kick-user": [
        commandPolicy<"moderators-only", typeof kickUser>(
          "moderators-only",
          {
            evaluate: () => false
          }
        )
      ]
    },
    commandAuthorizers: {
      "kick-user": () => {
        authorizerCalled = true;
        return true;
      }
    },
    commandHandlers: {
      "kick-user": () => {
        handlerCalled = true;
        return undefined;
      }
    }
  });
  const denyExplicitly = createServerRuntime({
    registry: createContractRegistry({
      commands: [kickUser] as const
    }),
    commandPolicies: {
      "kick-user": [
        commandPolicy<"requires-auth", typeof kickUser>("requires-auth", {
          evaluate: () => ({
            allowed: false as const,
            code: "unauthorized" as const,
            message: "Authentication is required."
          })
        })
      ]
    },
    commandHandlers: {
      "kick-user": () => undefined
    }
  });

  await assert.rejects(
    () =>
      denyByDefault.executeCommand(
        "kick-user",
        {
          userId: "user-1"
        },
        {
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "forbidden");
      assert.equal(
        error.message,
        'Command execution is denied by policy: "moderators-only".'
      );
      return true;
    }
  );

  assert.equal(authorizerCalled, false);
  assert.equal(handlerCalled, false);

  await assert.rejects(
    () =>
      denyExplicitly.executeCommand(
        "kick-user",
        {
          userId: "user-1"
        },
        {
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
 * Проверяет, что исключение внутри command policy не протекает наружу сырым
 * Error-объектом и нормализуется как `internal-error` со stage `command`.
 * Это важно, потому что security-ошибка внутри policy должна сохранять общую
 * error model и оставаться диагностируемой для transport/runtime слоя.
 * Также покрывается corner case с сохранением имени policy в details, чтобы
 * downstream-слой видел, какое именно правило сломалось.
 */
test("should normalize command policy failures into internal errors", async () => {
  const setVolume = command("set-volume", {
    input: z.object({
      level: z.number()
    }),
    ack: z.void()
  });
  let handlerCalled = false;
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [setVolume] as const
    }),
    commandPolicies: {
      "set-volume": [
        commandPolicy<"unstable-command-policy", typeof setVolume>(
          "unstable-command-policy",
          {
            evaluate: () => {
              throw new Error("RBAC backend is offline.");
            }
          }
        )
      ]
    },
    commandHandlers: {
      "set-volume": () => {
        handlerCalled = true;
        return undefined;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.executeCommand(
        "set-volume",
        {
          level: 42
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
        policyName: "unstable-command-policy",
        stage: "command"
      });
      return true;
    }
  );

  assert.equal(handlerCalled, false);
});
