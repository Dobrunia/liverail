import { z } from "zod";

import {
  channel,
  command,
  commandPolicy,
  connectPolicy,
  event,
  joinPolicy,
  receivePolicy,
  type CommandPolicyContract,
  type ConnectPolicyContract,
  type JoinPolicyContract,
  type PolicyDecision,
  type ReceivePolicyContract
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что scoped policy primitives возвращают
 * точные contract-типы для connect/join/command/receive сценариев.
 * Это важно, потому что enforcement-слой дальше должен навешивать политики
 * по их явному scope, а не по строковым соглашениям вручную.
 * Также покрывается corner case с deny decision, чтобы типы policy результата
 * уже на этом шаге были совместимы с unified error model.
 */
const moderateUsers = command("moderate-users", {
  input: z.object({
    roomId: z.string()
  }),
  ack: z.void()
});
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
const messageCreated = event("message-created", {
  payload: z.object({
    roomId: z.string()
  })
});

const canConnect = connectPolicy("can-connect", {
  evaluate: ({ context }: { context: { authenticated: boolean } }) =>
    context.authenticated
});
const canJoinVoiceRoom = joinPolicy("can-join-voice-room", {
  evaluate: ({
    contract,
    key
  }: {
    contract: typeof voiceRoom;
    key: { roomId: string };
  }) => contract.name === "voice-room" && key.roomId.length > 0
});
const canModerateUsers = commandPolicy("can-moderate-users", {
  evaluate: ({
    contract,
    input
  }: {
    contract: typeof moderateUsers;
    input: { roomId: string };
  }) => ({
    allowed: false as const,
    code: "forbidden" as const,
    details: {
      contractName: contract.name,
      roomId: input.roomId
    }
  })
});
const canReceiveMessageCreated = receivePolicy("can-receive-message-created", {
  evaluate: ({
    contract,
    payload,
    route
  }: {
    contract: typeof messageCreated;
    payload: { roomId: string };
    route: { target: string };
  }) => contract.name === "message-created" && payload.roomId === route.target
});

type ShouldBuildScopedPolicyContracts = Assert<
  IsEqual<typeof canConnect, ConnectPolicyContract<"can-connect", { authenticated: boolean }>> &
    IsEqual<
      typeof canJoinVoiceRoom,
      JoinPolicyContract<
        "can-join-voice-room",
        typeof voiceRoom,
        unknown
      >
    > &
    IsEqual<
      typeof canModerateUsers,
      CommandPolicyContract<
        "can-moderate-users",
        typeof moderateUsers,
        unknown,
        "forbidden"
      >
    > &
    IsEqual<
      typeof canReceiveMessageCreated,
      ReceivePolicyContract<
        "can-receive-message-created",
        typeof messageCreated,
        unknown,
        { target: string }
      >
    >
>;

type ShouldSupportExplicitDenyDecisions = Assert<
  IsEqual<
    Awaited<ReturnType<typeof canModerateUsers.evaluate>>,
    PolicyDecision<"forbidden"> | boolean
  >
>;

z;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
