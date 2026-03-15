import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  command,
  createContractRegistry,
  isRealtimeError
} from "dobrunia-liverail-contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет полный happy path command pipeline: input сначала валидируется,
 * затем проходит authorizer, потом handler, а после этого валидируется ack.
 * Это важно, потому что server runtime должен централизовать весь command flow,
 * а не оставлять разрозненные стадии на усмотрение конкретного handler-а.
 * Также покрывается corner case с `coerce` в input и ack schema, чтобы
 * авторизация и handler уже работали с нормализованными данными.
 */
test("should execute commands through validate authorize handle and ack stages", async () => {
  const stages: string[] = [];
  const setVolume = command("set-volume", {
    input: z.object({
      roomId: z.string(),
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.object({
      acceptedAt: z.coerce.date(),
      appliedLevel: z.coerce.number().int().min(0).max(100)
    })
  });
  const registry = createContractRegistry({
    commands: [setVolume] as const
  });
  const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
    registry,
    commandAuthorizers: {
      "set-volume": ({ input, context }) => {
        stages.push("authorize");
        assert.equal(input.level, 42);
        assert.equal(context.requestId, "req-1");
        return true;
      }
    },
    commandHandlers: {
      "set-volume": ({ input, context }) => {
        stages.push("handle");
        assert.equal(input.level, 42);
        assert.equal(context.requestId, "req-1");
        return {
          acceptedAt: "2026-03-13T12:00:00.000Z",
          appliedLevel: "42"
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
        requestId: "req-1"
      }
    }
  );

  assert.deepEqual(stages, ["authorize", "handle"]);
  assert.deepEqual(ack, {
    acceptedAt: new Date("2026-03-13T12:00:00.000Z"),
    appliedLevel: 42
  });
});

/**
 * Проверяет, что невалидный input обрывает pipeline до авторизации и handler-а
 * и возвращает уже нормализованную realtime validation error.
 * Это важно, потому что command pipeline не должен пропускать сырые данные
 * глубже в runtime и downstream handler-ы.
 * Также покрывается corner case с флагами вызова, чтобы подтвердить, что
 * ни authorizer, ни handler не исполняются после провала input validation.
 */
test("should stop command execution on invalid input before authorize and handle", async () => {
  let authorizeCalled = false;
  let handlerCalled = false;
  const setVolume = command("set-volume", {
    input: z.object({
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.void()
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [setVolume] as const
    }),
    commandAuthorizers: {
      "set-volume": () => {
        authorizeCalled = true;
        return true;
      }
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
          level: "200"
        },
        {
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-input");
      return true;
    }
  );

  assert.equal(authorizeCalled, false);
  assert.equal(handlerCalled, false);
});

/**
 * Проверяет, что authorizer может запретить выполнение команды до handler-а
 * и pipeline возвращает официальный realtime error с кодом `forbidden`.
 * Это важно, потому что auth/policy стадия должна быть отдельной фазой
 * command pipeline, а не частью бизнес-логики handler-а.
 * Также покрывается corner case с уже валидированным input в authorizer-е,
 * чтобы решение о доступе принималось на нормализованных данных.
 */
test("should reject forbidden command executions before the handler runs", async () => {
  let handlerCalled = false;
  const kickUser = command("kick-user", {
    input: z.object({
      userId: z.string()
    }),
    ack: z.void()
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [kickUser] as const
    }),
    commandAuthorizers: {
      "kick-user": ({ input }) => {
        assert.equal(input.userId, "user-1");
        return false;
      }
    },
    commandHandlers: {
      "kick-user": () => {
        handlerCalled = true;
        return undefined;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.executeCommand(
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
      assert.equal(error.message, 'Command execution is forbidden: "kick-user".');
      return true;
    }
  );

  assert.equal(handlerCalled, false);
});

/**
 * Проверяет, что handler-ошибки и невалидный ack проходят через единый слой
 * нормализации и не вытекают наружу сырыми runtime исключениями.
 * Это важно, потому что pipeline обязан закрывать и business failure, и
 * post-handler validation failure единообразно.
 * Также покрываются corner cases с generic Error и невалидным ack, чтобы
 * различать `command-failed` и `invalid-ack` без смешивания стадий.
 */
test("should normalize handler failures and invalid ack payloads", async () => {
  const crashCommand = command("crash", {
    input: z.void(),
    ack: z.void()
  });
  const setVolume = command("set-volume", {
    input: z.void(),
    ack: z.object({
      appliedLevel: z.number().int().min(0).max(100)
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [crashCommand, setVolume] as const
    }),
    commandHandlers: {
      crash: () => {
        throw new Error("Database is offline.");
      },
      "set-volume": () => ({
        appliedLevel: 200
      })
    }
  });

  await assert.rejects(
    () =>
      runtime.executeCommand("crash", undefined, {
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "command-failed");
      assert.deepEqual(error.details, {
        commandName: "crash",
        stage: "handle"
      });
      return true;
    }
  );

  await assert.rejects(
    () =>
      runtime.executeCommand("set-volume", undefined, {
        context: {}
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-ack");
      assert.equal(error.details?.source, "zod");
      return true;
    }
  );
});
