import { z } from "zod";

import {
  channel,
  createContractRegistry,
  type ChannelKey
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что membership runtime сохраняет точные типы key,
 * memberId и context для join execution и membership list.
 * Это важно, потому что channel membership должен опираться на channel contract,
 * а не терять типы после join/leave/list операций.
 * Также покрывается corner case с joinChannel, чтобы Promise резолвился в
 * typed membership конкретного канала, а не в обобщенный объект.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const registry = createContractRegistry({
  channels: [voiceRoom] as const
});
const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
  registry,
  channelJoinAuthorizers: {
    "voice-room": (execution) => {
      type ShouldTypeJoinExecution = Assert<
        IsEqual<
          typeof execution,
          {
            readonly contract: typeof voiceRoom;
            readonly name: "voice-room";
            readonly key: ChannelKey<typeof voiceRoom>;
            readonly memberId: string;
            readonly context: { requestId: string };
          }
        >
      >;

      return execution.context.requestId.length > 0;
    }
  }
});

const pendingMembership = runtime.joinChannel(
  "voice-room",
  {
    roomId: "room-1"
  },
  {
    memberId: "socket-1",
    context: {
      requestId: "req-1"
    }
  }
);
const listedMemberships = runtime.listChannelMembers("voice-room", {
  roomId: "room-1"
});

type ShouldReturnTypedMembership = Assert<
  IsEqual<
    typeof pendingMembership,
    Promise<{
      readonly contract: typeof voiceRoom;
      readonly name: "voice-room";
      readonly key: ChannelKey<typeof voiceRoom>;
      readonly memberId: string;
      readonly context: { requestId: string };
    }>
  >
>;

type ShouldReturnTypedMembershipList = Assert<
  IsEqual<
    typeof listedMemberships,
    readonly {
      readonly contract: typeof voiceRoom;
      readonly name: "voice-room";
      readonly key: ChannelKey<typeof voiceRoom>;
      readonly memberId: string;
      readonly context: { requestId: string };
    }[]
  >
>;

// @ts-expect-error channel membership runtime must enforce the known key schema
runtime.joinChannel("voice-room", { roomId: 42 }, {
  memberId: "socket-1",
  context: {
    requestId: "req-1"
  }
});

z;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
