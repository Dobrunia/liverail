import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  command,
  createContractRegistry,
  isRealtimeError
} from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.ts";

/**
 * Проверяет полный happy path typed command client API: input валидируется
 * до transport-вызова, transport получает уже нормализованные данные, а ack
 * валидируется и возвращается клиенту в typed форме.
 * Это важно, потому что client runtime должен заменять raw emit контрактным
 * вызовом и не пропускать невалидные данные между UI и transport adapter.
 * Также покрывается corner case с `coerce` в input и ack schema, чтобы и
 * transport, и пользовательский код работали с уже нормализованными значениями.
 */
test("should execute typed commands through the client transport", async () => {
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
  let receivedRequest:
    | {
        readonly name: string;
        readonly input: unknown;
      }
    | undefined;
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [setVolume] as const
    }),
    transport: {
      async sendCommand(request) {
        receivedRequest = request;

        return {
          status: "ack" as const,
          ack: {
            acceptedAt: "2026-03-13T12:00:00.000Z",
            appliedLevel: "42"
          }
        };
      }
    }
  });

  const ack = await runtime.executeCommand("set-volume", {
    roomId: "room-1",
    level: "42"
  });

  assert.deepEqual(receivedRequest, {
    name: "set-volume",
    input: {
      roomId: "room-1",
      level: 42
    }
  });
  assert.deepEqual(ack, {
    acceptedAt: new Date("2026-03-13T12:00:00.000Z"),
    appliedLevel: 42
  });
});

/**
 * Проверяет, что невалидный command input обрывает client pipeline до
 * transport-вызова и возвращает уже нормализованную validation error.
 * Это важно, потому что client runtime не должен выпускать сырые данные
 * наружу и перекладывать базовую contract validation на transport слой.
 * Также покрывается corner case с флагом вызова transport, чтобы гарантировать:
 * invalid input не отправляется в сеть даже при наличии transport adapter.
 */
test("should stop command execution on invalid input before the transport call", async () => {
  let transportCalled = false;
  const setVolume = command("set-volume", {
    input: z.object({
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.void()
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [setVolume] as const
    }),
    transport: {
      async sendCommand() {
        transportCalled = true;
        return {
          status: "ack" as const,
          ack: undefined
        };
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.executeCommand("set-volume", {
        level: "200"
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-input");
      return true;
    }
  );

  assert.equal(transportCalled, false);
});

/**
 * Проверяет, что client transport failure и невалидный ack проходят через
 * единый слой нормализации и не протекают наружу сырыми исключениями.
 * Это важно, потому что клиентский command API должен возвращать предсказуемые
 * realtime errors, а не смешивать transport ошибки и contract validation.
 * Также покрываются corner cases с raw Error и invalid ack, чтобы различать
 * `command-failed` и `invalid-ack` без размытия стадий pipeline.
 */
test("should normalize transport failures and invalid command ack payloads", async () => {
  const crash = command("crash", {
    input: z.void(),
    ack: z.void()
  });
  const setVolume = command("set-volume", {
    input: z.void(),
    ack: z.object({
      appliedLevel: z.number().int().min(0).max(100)
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [crash, setVolume] as const
    }),
    transport: {
      async sendCommand(request) {
        if (request.name === "crash") {
          throw new Error("Socket is closed.");
        }

        return {
          status: "ack" as const,
          ack: {
            appliedLevel: 200
          }
        };
      }
    }
  });

  await assert.rejects(
    () => runtime.executeCommand("crash", undefined),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "command-failed");
      assert.deepEqual(error.details, {
        commandName: "crash",
        stage: "transport"
      });
      return true;
    }
  );

  await assert.rejects(
    () => runtime.executeCommand("set-volume", undefined),
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

/**
 * Проверяет, что command failure и timeout могут быть выражены явным transport
 * result status, а client runtime нормализует их в официальный error model.
 * Это важно, потому что для реального transport слоя недостаточно различать
 * только `ack` и `missing-ack`: нужны еще предсказуемые failure и timeout ветки.
 * Также покрываются corner cases с explicit realtime error и timeout override,
 * чтобы per-call надежность не зависела от неявного поведения transport adapter.
 */
test("should normalize explicit command failure and timeout results", async () => {
  const crash = command("crash", {
    input: z.void(),
    ack: z.void()
  });
  const slow = command("slow", {
    input: z.void(),
    ack: z.void()
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [crash, slow] as const
    }),
    commandTimeoutMs: 5,
    transport: {
      sendCommand(request) {
        if (request.name === "crash") {
          return {
            status: "error" as const,
            error: new Error("Socket write failed.")
          };
        }

        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              status: "ack" as const,
              ack: undefined
            });
          }, 50);
        });
      }
    }
  });

  await assert.rejects(
    () => runtime.executeCommand("crash", undefined),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "command-failed");
      assert.deepEqual(error.details, {
        commandName: "crash",
        stage: "transport"
      });
      return true;
    }
  );

  await assert.rejects(
    () =>
      runtime.executeCommand("slow", undefined, {
        timeoutMs: 10
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "timeout");
      assert.deepEqual(error.details, {
        commandName: "slow",
        timeoutMs: 10
      });
      return true;
    }
  );
});

/**
 * Проверяет, что transport-level отсутствие ack не смешивается с `invalid-ack`
 * и нормализуется в отдельный официальный realtime error `missing-ack`.
 * Это важно, потому что для reliability-слоя нужно различать "ack пришел,
 * но сломан" и "ack вообще не пришел", иначе поведение команды слишком неявно.
 * Также покрывается corner case с `z.void()`-ack, чтобы отсутствие значения
 * отличалось от явного `{ status: "ack", ack: undefined }`.
 */
test("should reject command executions with a missing transport ack", async () => {
  const ping = command("ping", {
    input: z.void(),
    ack: z.void()
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [ping] as const
    }),
    transport: {
      async sendCommand() {
        return {
          status: "missing-ack" as const
        };
      }
    }
  });

  await assert.rejects(
    () => runtime.executeCommand("ping", undefined),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "missing-ack");
      assert.equal(error.message, 'Command ack is missing: "ping".');
      return true;
    }
  );
});
