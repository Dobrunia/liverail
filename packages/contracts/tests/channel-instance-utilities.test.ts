import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createChannelInstance,
  isSameChannelInstance,
  parseChannelInstance,
  stringifyChannelInstance
} from "../src/index.ts";

/**
 * Проверяет, что канал дает единый официальный способ создавать конкретный
 * instance, сериализовать его, распарсить обратно и сравнить без ручных
 * строковых соглашений. Это важно, потому что addressable channel instances
 * используются одновременно в client, server и transport layer.
 * Также покрывается corner case с нормализацией key через schema, чтобы
 * `channel.of(...)` и `createChannelInstance(...)` сходились в одном
 * каноническом идентификаторе независимо от сырого входного значения.
 */
test("should create stringify parse and compare channel instances through one canonical utility layer", () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const fromContract = voiceRoom.of({
    roomId: "  room-1  "
  });
  const fromFactory = createChannelInstance(voiceRoom, {
    roomId: "room-1"
  });
  const parsed = parseChannelInstance(voiceRoom, fromContract.id);

  assert.equal(fromContract.id, "voice-room:{\"roomId\":\"room-1\"}");
  assert.equal(stringifyChannelInstance(fromFactory), fromContract.id);
  assert.equal(parsed.contract, voiceRoom);
  assert.equal(parsed.name, fromContract.name);
  assert.deepEqual(parsed.key, fromContract.key);
  assert.equal(parsed.id, fromContract.id);
  assert.equal(isSameChannelInstance(fromContract, fromFactory), true);
});

/**
 * Проверяет, что parser channel instance id не принимает чужой channel name
 * и не дает случайно смешивать инстансы разных channel contracts. Это важно,
 * потому что канонический serializer должен быть пригоден для безопасной
 * адресации, а не только для удобного stringify.
 * Также покрывается corner case с формально валидным JSON внутри id, но с
 * неверным именем канала, чтобы ошибка возникала до любых последующих
 * операций подписки или membership lookup.
 */
test("should reject serialized channel instances that belong to another channel contract", () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });

  assert.throws(
    () => parseChannelInstance(voiceRoom, "presence-room:{\"roomId\":\"room-1\"}"),
    /voice-room/
  );
});
