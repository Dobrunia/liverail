import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  defineChannels,
  defineCommands,
  defineEvents,
  event
} from "@dobrunia-liverail/contracts";
import {
  createServerRuntime,
  defineServerRuntime
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что no-context server runtime допускает
 * короткий happy path без явного `{ context: undefined }` и без потери
 * точных command/event/channel имен. Это важно, потому что default должен
 * уменьшать boilerplate, не размывая сигнатуры публичного API.
 * Также покрывается corner case с join options, где `memberId` остается
 * обязательным даже при отсутствии отдельного runtime context.
 */
const ping = command("ping", {
  input: z.object({
    roomId: z.string()
  }),
  ack: z.object({
    ok: z.literal(true)
  })
});
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string()
  })
});
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const noContextRuntime = defineServerRuntime({
  registry: createContractRegistry({
    commands: defineCommands(ping),
    events: defineEvents(messageCreated),
    channels: defineChannels(voiceRoom)
  }),
  commandHandlers: {
    ping: () => ({
      ok: true as const
    })
  },
  eventRouters: {
    "message-created": () => ({
      target: "room:room-1"
    })
  },
  eventDeliverers: {
    "message-created": () => undefined
  }
});

noContextRuntime.authorizeConnection();
noContextRuntime.executeCommand("ping", {
  roomId: "room-1"
});
noContextRuntime.emitEvent("message-created", {
  text: "hello"
});
noContextRuntime.joinChannel("voice-room", {
  roomId: "room-1"
}, {
  memberId: "user-1"
});

const runtimeWithContext = createServerRuntime<{ requestId: string }>({
  registry: createContractRegistry({
    commands: defineCommands(ping)
  }),
  commandHandlers: {
    ping: (_execution) => ({
      ok: true as const
    })
  }
});

runtimeWithContext.executeCommand(
  "ping",
  {
    roomId: "room-1"
  },
  {
    context: {
      requestId: "req-1"
    }
  }
);

// @ts-expect-error runtime with explicit context must still require execution options
runtimeWithContext.executeCommand("ping", {
  roomId: "room-1"
});
