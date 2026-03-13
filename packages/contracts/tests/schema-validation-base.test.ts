import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  command,
  event,
  isRealtimeValidationError,
  parseChannelKey,
  parseCommandInput,
  parseEventPayload
} from "../src/index.ts";

/**
 * Проверяет, что command input проходит через Zod-схему и возвращается уже
 * в нормализованном виде, а не как сырое пользовательское значение.
 * Это важно, потому что contracts-слой должен стать единым источником и для
 * runtime validation, и для type inference без дублирования маппинга данных.
 * Также покрывается edge case с `coerce`, чтобы подтвердить поддержку схем,
 * у которых входной и выходной тип отличаются.
 */
test("should parse command input through a zod schema and return normalized data", () => {
  const volumeCommand = command("set-volume", {
    input: z.object({
      roomId: z.string().min(1),
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.void()
  });

  const parsedInput = parseCommandInput(volumeCommand, {
    roomId: "room-1",
    level: "42"
  });

  assert.deepEqual(parsedInput, {
    roomId: "room-1",
    level: 42
  });
});

/**
 * Проверяет, что event payload и channel key валидируются той же базовой
 * Zod-моделью, что и command input.
 * Это важно, потому что validation layer должен быть единообразным для всех
 * базовых контрактов и не плодить отдельные несовместимые механизмы.
 * Тест учитывает corner cases с trim и coercion, чтобы подтвердить поддержку
 * нормализации значений во время парсинга.
 */
test("should parse event payload and channel key through zod schemas", () => {
  const memberJoinedEvent = event("member-joined", {
    payload: z.object({
      roomId: z.string().trim().min(1),
      joinedAt: z.coerce.date()
    })
  });
  const voiceRoomChannel = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });

  const parsedPayload = parseEventPayload(memberJoinedEvent, {
    roomId: "  room-1  ",
    joinedAt: "2026-03-13T12:00:00.000Z"
  });
  const parsedKey = parseChannelKey(voiceRoomChannel, {
    roomId: "  room-1  "
  });

  assert.deepEqual(parsedPayload, {
    roomId: "room-1",
    joinedAt: new Date("2026-03-13T12:00:00.000Z")
  });
  assert.deepEqual(parsedKey, {
    roomId: "room-1"
  });
});

/**
 * Проверяет, что при невалидных значениях parse-helper-ы выбрасывают уже
 * нормализованный realtime error с правильным code и issue-path.
 * Это важно, потому что validation ошибки больше не должны протекать наружу
 * сырыми ZodError-объектами и должны иметь стабильный общий формат.
 * Также покрываются corner cases с несколькими helper-ами, чтобы одинаковая
 * нормализация применялась к command input, event payload и channel key.
 */
test("should normalize invalid contract values into realtime validation errors", () => {
  const volumeCommand = command("set-volume", {
    input: z.object({
      roomId: z.string().min(1),
      level: z.coerce.number().int().min(0).max(100)
    }),
    ack: z.void()
  });
  const memberJoinedEvent = event("member-joined", {
    payload: z.object({
      joinedAt: z.coerce.date()
    })
  });
  const voiceRoomChannel = channel("voice-room", {
    key: z.object({
      roomId: z.string().uuid()
    })
  });

  assert.throws(
    () =>
      parseCommandInput(volumeCommand, {
        roomId: "room-1",
        level: "200"
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-input");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "level");
      return true;
    }
  );

  assert.throws(
    () =>
      parseEventPayload(memberJoinedEvent, {
        joinedAt: "not-a-date"
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-event-payload");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "joinedAt");
      return true;
    }
  );

  assert.throws(
    () =>
      parseChannelKey(voiceRoomChannel, {
        roomId: "room-1"
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-channel-key");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "roomId");
      return true;
    }
  );
});
