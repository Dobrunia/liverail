import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  command,
  commandPolicy,
  connectPolicy,
  event,
  joinPolicy,
  receivePolicy
} from "../src/index.ts";

/**
 * Проверяет, что для policy layer есть отдельные маленькие примитивы
 * `connect/join/command/receive`, и каждый из них сохраняет явный scope.
 * Это важно, потому что дальше enforcement-слой должен опираться не на
 * абстрактный "какой-то policy", а на понятные типы правил доступа.
 * Также покрывается corner case с разными контрактными сущностями, чтобы
 * join/command/receive policy сразу были привязаны к правильному контексту.
 */
test("should create scoped realtime policy primitives for connect join command and receive", async () => {
  const moderationCommand = command("ban-user", {
    input: z.object({
      userId: z.string()
    }),
    ack: z.void()
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const memberJoined = event("member-joined", {
    payload: z.object({
      roomId: z.string()
    })
  });

  const canConnect = connectPolicy("can-connect", {
    evaluate: async ({ context }: { context: { authenticated: boolean } }) =>
      context.authenticated
  });
  const canJoinVoiceRoom = joinPolicy("can-join-voice-room", {
    evaluate: ({
      contract,
      key,
      memberId
    }: {
      contract: typeof voiceRoom;
      key: { roomId: string };
      memberId: string;
    }) => contract.name === "voice-room" && key.roomId.length > 0 && memberId.length > 0
  });
  const canBanUsers = commandPolicy("can-ban-users", {
    evaluate: ({
      contract,
      input
    }: {
      contract: typeof moderationCommand;
      input: { userId: string };
    }) => contract.name === "ban-user" && input.userId.length > 0
  });
  const canReceiveMemberJoined = receivePolicy("can-receive-member-joined", {
    evaluate: ({
      contract,
      payload
    }: {
      contract: typeof memberJoined;
      payload: { roomId: string };
    }) => contract.name === "member-joined" && payload.roomId.length > 0
  });

  assert.equal(canConnect.kind, "policy");
  assert.equal(canConnect.scope, "connect");
  assert.equal(
    await canConnect.evaluate({
      context: {
        authenticated: true
      }
    }),
    true
  );

  assert.equal(canJoinVoiceRoom.scope, "join");
  assert.equal(
    await canJoinVoiceRoom.evaluate({
      contract: voiceRoom,
      name: "voice-room",
      key: {
        roomId: "room-1"
      },
      memberId: "socket-1",
      context: {}
    }),
    true
  );

  assert.equal(canBanUsers.scope, "command");
  assert.equal(
    await canBanUsers.evaluate({
      contract: moderationCommand,
      name: "ban-user",
      input: {
        userId: "user-1"
      },
      context: {}
    }),
    true
  );

  assert.equal(canReceiveMemberJoined.scope, "receive");
  assert.equal(
    await canReceiveMemberJoined.evaluate({
      contract: memberJoined,
      name: "member-joined",
      payload: {
        roomId: "room-1"
      },
      route: {
        target: "room:room-1"
      },
      context: {}
    }),
    true
  );
});

/**
 * Проверяет, что policy evaluator может вернуть не только boolean, но и
 * явный deny decision с кодом и дополнительными details.
 * Это важно, потому что enforcement-слой должен уметь различать обычный
 * "false" и осознанный отказ с конкретным официальным error code.
 * Также покрывается corner case с join-denied, чтобы новые policy primitives
 * сразу были совместимы с уже существующей unified error model.
 */
test("should preserve explicit deny decisions inside scoped policy evaluators", async () => {
  const contract = joinPolicy("can-join-private-room", {
    evaluate: () => ({
      allowed: false as const,
      code: "join-denied" as const,
      message: "Room is private.",
      details: {
        roomId: "room-1"
      }
    })
  });

  const result = await contract.evaluate({
    contract: channel("voice-room", {
      key: z.object({
        roomId: z.string()
      })
    }),
    name: "voice-room",
    key: {
      roomId: "room-1"
    },
    memberId: "socket-1",
    context: {}
  });

  assert.deepEqual(result, {
    allowed: false,
    code: "join-denied",
    message: "Room is private.",
    details: {
      roomId: "room-1"
    }
  });
});
