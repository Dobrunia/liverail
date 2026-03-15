import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.ts";

/**
 * Проверяет, что typed client subscription API отдает тот же канонический
 * идентификатор channel instance, что и shared channel utilities, а не
 * строит свою локальную строковую схему хранения. Это важно, потому что
 * duplicate subscribe, reconnect и cleanup должны опираться на один id.
 * Также покрывается corner case с повторной подпиской на уже нормализованный
 * instance, чтобы клиентский runtime не расходился с `channel.of(...)`.
 */
test("should expose canonical channel instance ids through the typed subscription API", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        return undefined;
      },
      async unsubscribeChannel() {
        return undefined;
      }
    }
  });
  const expectedInstance = voiceRoom.of({
    roomId: "room-1"
  });
  const firstSubscription = await runtime.subscribeChannel("voice-room", {
    roomId: "  room-1  "
  });
  const secondSubscription = await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });

  assert.equal(firstSubscription.id, expectedInstance.id);
  assert.equal(secondSubscription.id, expectedInstance.id);
  assert.equal(firstSubscription, secondSubscription);
});
