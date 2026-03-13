import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что typed client subscription API несет
 * канонический channel instance id вместе с точным key shape. Это важно,
 * потому что клиентский runtime должен использовать общий channel utility
 * слой, а не возвращать частично typed локальную структуру.
 * Также покрывается corner case с literal channel name, чтобы id-поле
 * появлялось на той же подписке, где уже доступны contract и key-типы.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    channels: [voiceRoom] as const
  })
});

runtime.subscribeChannel("voice-room", {
  roomId: "room-1"
}).then((subscription) => {
  subscription.id;
  subscription.contract.name;
  subscription.key.roomId;
});
