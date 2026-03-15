import { z } from "zod";

import {
  channel,
  createContractRegistry,
  defineChannels
} from "dobrunia-liverail-contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что server lifecycle hooks получают typed
 * connection/join/leave данные из официального runtime API. Это важно,
 * потому что hooks должны быть пригодны для presence и cleanup логики без
 * ручных кастов и строковых соглашений поверх transport layer.
 * Также покрывается corner case с join hook context, чтобы контекст из
 * runtime не терялся при переходе в lifecycle extension points.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const registry = createContractRegistry({
  channels: defineChannels(voiceRoom)
});

createServerRuntime<{ requestId: string }, typeof registry>({
  registry,
  lifecycleHooks: {
    onConnect: (connection) => {
      connection.connectionId;
      connection.context.requestId;
    },
    onDisconnect: (connection) => {
      connection.connectionId;
      connection.context.requestId;
    },
    onJoin: (membership) => {
      membership.contract.name;
      membership.key.roomId;
      membership.context.requestId;
    },
    onLeave: (execution) => {
      execution.contract.name;
      execution.key.roomId;
      execution.memberId;
    }
  }
});
