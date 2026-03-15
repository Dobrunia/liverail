import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что client runtime дает отдельный typed API
 * для system events и не смешивает lifecycle/operational-сигналы с обычными
 * domain event listeners. Это важно, потому что UI должен получать точные
 * payload-типы для connected/join_failed и других служебных состояний.
 * Также покрывается corner case с unknown system event name, чтобы новый API
 * не принимал произвольные строки и не размывал официальный event model.
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

runtime.onSystemEvent("connected", (event) => {
  event.kind;
  event.name;
  event.payload.state;
  event.payload.previousState;
});

runtime.onSystemEvent("join_failed", (event) => {
  event.payload.channelName;
  event.payload.key;
  event.payload.error.code;
});

runtime.onSystemEvent(
  // @ts-expect-error dedicated system event API must reject unknown names
  "message-created",
  () => undefined
);
