import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  connectPolicy,
  createContractRegistry,
  event,
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что server runtime отдает read-only debug snapshot текущего
 * operational-состояния: зарегистрированные contracts, подключенные handlers
 * и активные channel memberships. Это важно, потому что без такого снимка
 * серверный realtime-слой остается "черным ящиком" даже при корректной работе.
 * Также покрывается corner case с несколькими участниками одного channel
 * instance, чтобы debug utility показывал именно агрегированное состояние
 * активного канала, а не набор разрозненных membership-записей.
 */
test("should expose a read-only server runtime debug snapshot", async () => {
  const sendMessage = command("send-message", {
    input: z.void(),
    ack: z.void()
  });
  const messageCreated = event("message-created", {
    payload: z.void()
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const canConnect = connectPolicy("can-connect", {
    evaluate: () => true
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [sendMessage] as const,
      events: [messageCreated] as const,
      channels: [voiceRoom] as const,
      policies: [canConnect] as const
    }),
    connectionPolicies: [canConnect],
    commandHandlers: {
      "send-message": () => undefined
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

  await runtime.joinChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "socket-1",
    context: {}
  });
  await runtime.joinChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "socket-2",
    context: {}
  });

  const debugSnapshot = runtime.inspectRuntime();

  assert.equal(Object.isFrozen(debugSnapshot), true);
  assert.equal(debugSnapshot.state, "ready");
  assert.deepEqual(debugSnapshot.contracts.commands.names, ["send-message"]);
  assert.deepEqual(debugSnapshot.connectionPolicyNames, ["can-connect"]);
  assert.deepEqual(debugSnapshot.commandHandlerNames, ["send-message"]);
  assert.deepEqual(debugSnapshot.eventRouterNames, ["message-created"]);
  assert.deepEqual(debugSnapshot.eventDelivererNames, ["message-created"]);
  assert.equal(debugSnapshot.activeChannels.length, 1);
  assert.deepEqual(debugSnapshot.activeChannels[0], {
    contract: voiceRoom,
    name: "voice-room",
    key: {
      roomId: "room-1"
    },
    memberCount: 2,
    memberIds: ["socket-1", "socket-2"]
  });
});
