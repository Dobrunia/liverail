import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import { channel } from "@dobrunia-liverail/contracts";
import { getSocketIoChannelRoom } from "../src/socket-io-entry.ts";

/**
 * Проверяет, что server transport utilities используют тот же канонический
 * serializer channel instance, что и shared contracts layer, а не отдельную
 * ad-hoc схему для room ids. Это важно, потому что membership runtime и
 * transport routing должны совпадать по адресации конкретного channel.
 * Также покрывается corner case с нормализацией key, чтобы room id строился
 * из уже очищенного значения, а не из сырого пользовательского ввода.
 */
test("should derive Socket.IO room ids from the canonical channel instance serializer", () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const instance = voiceRoom.of({
    roomId: "  room-1  "
  });

  assert.equal(
    getSocketIoChannelRoom("voice-room", {
      roomId: "room-1"
    }),
    `liverail:channel:${instance.id}`
  );
});
