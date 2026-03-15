import { z } from "zod";

import {
  channel,
  createContractRegistry,
  joinPolicy,
  type ChannelKey,
  type JoinPolicyContract
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что join policy enforcement принимает scoped
 * join policy, сохраняет точный execution context и не размывает типы канала.
 * Это важно, потому что join layer должен быть централизованным, но при этом
 * оставаться строго привязанным к channel contract и runtime context.
 * Также покрывается corner case с `joinChannel`, чтобы runtime требовал тот же
 * context shape, что и подключенные join policy для конкретного канала.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const registry = createContractRegistry({
  channels: [voiceRoom] as const
});
const canJoinVoiceRoom = joinPolicy<
  "can-join-voice-room",
  typeof voiceRoom,
  { role: "member" | "guest" }
>("can-join-voice-room", {
  evaluate: (execution) => {
    type ShouldTypeJoinPolicyExecution = Assert<
      IsEqual<
        typeof execution,
        {
          readonly contract: typeof voiceRoom;
          readonly name: "voice-room";
          readonly key: ChannelKey<typeof voiceRoom>;
          readonly memberId: string;
          readonly context: { role: "member" | "guest" };
        }
      >
    >;

    return execution.context.role === "member";
  }
});
const runtime = createServerRuntime<{ role: "member" | "guest" }, typeof registry>(
  {
    registry,
    channelJoinPolicies: {
      "voice-room": [canJoinVoiceRoom]
    }
  }
);

type ShouldAcceptTypedJoinPolicies = Assert<
  IsEqual<
    typeof canJoinVoiceRoom,
    JoinPolicyContract<
      "can-join-voice-room",
      typeof voiceRoom,
      { role: "member" | "guest" }
    >
  >
>;

const pendingMembership = runtime.joinChannel(
  "voice-room",
  {
    roomId: "room-1"
  },
  {
    memberId: "socket-1",
    context: {
      role: "member"
    }
  }
);

type ShouldReturnTypedMembershipAfterJoinPolicies = Assert<
  IsEqual<
    typeof pendingMembership,
    Promise<{
      readonly contract: typeof voiceRoom;
      readonly name: "voice-room";
      readonly key: ChannelKey<typeof voiceRoom>;
      readonly memberId: string;
      readonly context: { role: "member" | "guest" };
    }>
  >
>;

runtime.joinChannel("voice-room", {
  roomId: "room-1"
}, {
  memberId: "socket-1",
  // @ts-expect-error join policy enforcement must keep the runtime context shape
  context: {}
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
