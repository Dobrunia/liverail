import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  command,
  createContractRegistry,
  isRealtimeValidationError,
  parseCommandAck,
  parseCommandInput
} from "../src/index.ts";

/**
 * Проверяет, что command input и command ack являются двумя независимыми
 * schema-частями одного контракта и валидируются отдельными helper-ами.
 * Это важно, потому что ack не должен быть "любым объектом" и должен иметь
 * такой же строгий контракт, как и вход команды.
 * Также покрывается edge case с преобразованием строки в `Date`, чтобы показать,
 * что input и ack могут иметь разные схемы и разные выходные типы.
 */
test("should validate command input and ack as separate schema contracts", () => {
  const setVolumeCommand = command("set-volume", {
    input: z.object({
      roomId: z.string(),
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.object({
      acceptedAt: z.coerce.date(),
      appliedLevel: z.number().int().min(0).max(100)
    })
  });

  const parsedInput = parseCommandInput(setVolumeCommand, {
    roomId: "room-1",
    level: "42"
  });
  const parsedAck = parseCommandAck(setVolumeCommand, {
    acceptedAt: "2026-03-13T12:00:00.000Z",
    appliedLevel: 42
  });

  assert.deepEqual(parsedInput, {
    roomId: "room-1",
    level: 42
  });
  assert.deepEqual(parsedAck, {
    acceptedAt: new Date("2026-03-13T12:00:00.000Z"),
    appliedLevel: 42
  });
});

/**
 * Проверяет, что command definition больше не допускает отсутствие input
 * или ack schema даже если типовые ограничения были обойдены.
 * Это важно, потому что после введения command contracts команда без одной
 * из схем снова деградирует в нестрогий transport-level вызов.
 * Тест учитывает corner cases с отсутствием каждой из частей по отдельности,
 * чтобы ошибка возникала явно в момент объявления контракта.
 */
test("should reject command contracts without explicit input and ack schemas", () => {
  assert.throws(
    () =>
      command("invalid-command", {
        ack: z.object({
          ok: z.boolean()
        })
      } as never),
    {
      name: "TypeError",
      message: "Command contracts must declare an input schema."
    }
  );

  assert.throws(
    () =>
      command("invalid-command", {
        input: z.object({
          roomId: z.string()
        })
      } as never),
    {
      name: "TypeError",
      message: "Command contracts must declare an ack schema."
    }
  );
});

/**
 * Проверяет, что команды без полезной нагрузки или без содержательного ack
 * могут быть описаны только через явные `z.void()` schema.
 * Это важно, потому что strict command model не должна ломать сценарии без
 * payload, но при этом обязана сохранять явность контракта.
 * Также покрывается edge case с registry, чтобы lookup по имени сохранял
 * уже строгую command-модель без потери schema-ссылок.
 */
test("should allow empty command payloads only through explicit void schemas", () => {
  const pingCommand = command("ping", {
    input: z.void(),
    ack: z.void()
  });
  const registry = createContractRegistry({
    commands: [pingCommand] as const
  });

  assert.equal(parseCommandInput(pingCommand, undefined), undefined);
  assert.equal(parseCommandAck(pingCommand, undefined), undefined);
  assert.equal(registry.commands.byName.ping.input, pingCommand.input);
  assert.equal(registry.commands.byName.ping.ack, pingCommand.ack);
});

/**
 * Проверяет, что невалидный ack нормализуется в unified realtime error
 * с кодом `invalid-ack` и сохраненным issue-path.
 * Это важно, потому что command input и command ack должны вести себя одинаково
 * с точки зрения error model и не требовать отдельного формата ошибок.
 * Тест учитывает corner case с ошибкой во вложенном поле ack, чтобы downstream-слои
 * не теряли точный путь до проблемного значения.
 */
test("should normalize invalid command ack payloads into realtime errors", () => {
  const setVolumeCommand = command("set-volume", {
    input: z.object({
      roomId: z.string(),
      level: z.coerce.number()
    }),
    ack: z.object({
      result: z.object({
        appliedLevel: z.number().int().min(0).max(100)
      })
    })
  });

  assert.throws(
    () =>
      parseCommandAck(setVolumeCommand, {
        result: {
          appliedLevel: 120
        }
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-ack");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "result.appliedLevel");
      return true;
    }
  );
});
