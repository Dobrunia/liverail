import { z } from "zod";

import {
  channel,
  command,
  event,
  parseChannelKey,
  parseCommandInput,
  parseEventPayload
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что одна и та же Zod-схема одновременно
 * управляет типом аргумента parse-helper-а и типом результата после парсинга.
 * Это важно, потому что validation base должна связывать runtime validation
 * и type inference без отдельного ручного описания input/output shape.
 * Также покрывается corner case с `coerce`, где вход и выход схемы различаются.
 */
type ShouldInferCommandValidationInputAndOutputFromOneZodSchema = Assert<
  IsEqual<
    typeof parsedCommandInput,
    {
      roomId: string;
      level: number;
    }
  >
>;

/**
 * Проверяет на уровне компиляции, что event payload и channel key получают ту же
 * согласованную типизацию через parse-helper-ы.
 * Это важно, потому что validation layer должен быть общим для всех contract kinds,
 * а не только для команд.
 * Дополнительно учитывается corner case с преобразованием строки в `Date`,
 * чтобы зафиксировать поддержку выходного типа, отличного от сырого входа.
 */
type ShouldInferEventAndChannelValidationOutputsFromZodSchemas = Assert<
  IsEqual<
    typeof parsedEventPayload,
    {
      roomId: string;
      joinedAt: Date;
    }
  > &
    IsEqual<
      typeof parsedChannelKey,
      {
        roomId: string;
      }
    >
>;

const volumeCommand = command("set-volume", {
  input: z.object({
    roomId: z.string(),
    level: z.coerce.number().int().min(0).max(100)
  }),
  ack: z.void()
});

const memberJoinedEvent = event("member-joined", {
  payload: z.object({
    roomId: z.string(),
    joinedAt: z.coerce.date()
  })
});

const voiceRoomChannel = channel("voice-room", {
  key: z.object({
    roomId: z.string().trim().min(1)
  })
});

const parsedCommandInput = parseCommandInput(volumeCommand, {
  roomId: "room-1",
  level: "42"
});

const parsedEventPayload = parseEventPayload(memberJoinedEvent, {
  roomId: "room-1",
  joinedAt: "2026-03-13T12:00:00.000Z"
});

const parsedChannelKey = parseChannelKey(voiceRoomChannel, {
  roomId: "  room-1  "
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
