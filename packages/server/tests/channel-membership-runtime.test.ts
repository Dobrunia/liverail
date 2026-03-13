import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  createContractRegistry,
  isRealtimeError
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что join runtime строится на channel contract, валидирует key,
 * допускает authorizer-стадию и сохраняет typed membership в памяти.
 * Это важно, потому что rooms/channels на сервере должны быть управляемыми
 * сущностями, а не набором строк и разрозненных структур.
 * Также покрывается corner case с двумя участниками одного канала, чтобы
 * membership storage был привязан именно к channel instance, а не к вызову.
 */
test("should join channels with validated keys and keep typed memberships", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const registry = createContractRegistry({
    channels: [voiceRoom] as const
  });
  const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
    registry,
    channelJoinAuthorizers: {
      "voice-room": ({ key, memberId, context }) => {
        assert.equal(key.roomId, "room-1");
        assert.match(memberId, /^socket-/);
        assert.match(context.requestId, /^req-/);
        return true;
      }
    }
  });

  const firstMembership = await runtime.joinChannel(
    "voice-room",
    {
      roomId: "  room-1  "
    },
    {
      memberId: "socket-1",
      context: {
        requestId: "req-1"
      }
    }
  );
  const secondMembership = await runtime.joinChannel(
    "voice-room",
    {
      roomId: "room-1"
    },
    {
      memberId: "socket-2",
      context: {
        requestId: "req-2"
      }
    }
  );
  const members = runtime.listChannelMembers("voice-room", {
    roomId: "room-1"
  });

  assert.equal(firstMembership.key.roomId, "room-1");
  assert.equal(secondMembership.memberId, "socket-2");
  assert.deepEqual(
    members.map((entry) => entry.memberId),
    ["socket-1", "socket-2"]
  );
  assert.ok(Object.isFrozen(members));
});

/**
 * Проверяет, что невалидный channel key обрывает join до authorizer-а и
 * membership storage остается нетронутым.
 * Это важно, потому что адресация каналов должна оставаться строгой и
 * не пропускать невалидные room keys глубже в runtime.
 * Также покрывается corner case с флагом вызова authorizer-а, чтобы гарантировать:
 * invalid key не может повлиять на access logic или состояние membership.
 */
test("should stop channel joins on invalid keys before authorization", async () => {
  let authorizerCalled = false;
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().uuid()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelJoinAuthorizers: {
      "voice-room": () => {
        authorizerCalled = true;
        return true;
      }
    }
  });

  await assert.rejects(
    () =>
      runtime.joinChannel(
        "voice-room",
        {
          roomId: "room-1"
        },
        {
          memberId: "socket-1",
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-channel-key");
      return true;
    }
  );

  assert.equal(authorizerCalled, false);
  assert.deepEqual(
    runtime.listChannelMembers("voice-room", {
      roomId: "550e8400-e29b-41d4-a716-446655440000"
    }),
    []
  );
});

/**
 * Проверяет, что join authorizer может отказать во входе с официальным кодом
 * `join-denied`, а membership storage не получает запись после отказа.
 * Это важно, потому что join-доступ должен существовать как отдельный runtime
 * слой, а не размазываться по transport-коду или handler-ам команд.
 * Также покрывается corner case с уже нормализованным ключом, чтобы deny
 * принимался на валидных данных и не смешивался с validation failure.
 */
test("should reject denied joins with the official join-denied code", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelJoinAuthorizers: {
      "voice-room": ({ key }) => key.roomId !== "room-1"
    }
  });

  await assert.rejects(
    () =>
      runtime.joinChannel(
        "voice-room",
        {
          roomId: "room-1"
        },
        {
          memberId: "socket-1",
          context: {}
        }
      ),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "join-denied");
      assert.equal(error.message, 'Channel join is denied: "voice-room".');
      return true;
    }
  );

  assert.deepEqual(
    runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }),
    []
  );
});

/**
 * Проверяет, что leave runtime удаляет только нужного участника из конкретного
 * channel instance и возвращает предсказуемый boolean-результат.
 * Это важно, потому что server membership storage должен быть детерминированным
 * и пригодным для дальнейшей интеграции с transport и delivery слоями.
 * Также покрывается corner case с повторным leave, чтобы операция была
 * идемпотентной по результату и не ломала внутреннее состояние.
 */
test("should leave channels and clean up stored memberships deterministically", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    })
  });

  await runtime.joinChannel(
    "voice-room",
    {
      roomId: "room-1"
    },
    {
      memberId: "socket-1",
      context: {}
    }
  );
  await runtime.joinChannel(
    "voice-room",
    {
      roomId: "room-1"
    },
    {
      memberId: "socket-2",
      context: {}
    }
  );

  const firstLeave = await runtime.leaveChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "socket-1"
  });
  const secondLeave = await runtime.leaveChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "socket-1"
  });

  assert.equal(firstLeave, true);
  assert.equal(secondLeave, false);
  assert.deepEqual(
    runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }).map((entry) => entry.memberId),
    ["socket-2"]
  );
});
