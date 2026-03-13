import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  command,
  createContractRegistry,
  isRealtimeError
} from "@liverail/contracts";
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
          acceptedAt: "2026-03-13T12:00:00.000Z",
          appliedLevel: "42"
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
        return undefined;
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
          appliedLevel: 200
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
