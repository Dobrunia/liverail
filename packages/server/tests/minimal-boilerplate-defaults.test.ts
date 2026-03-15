import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что server runtime не требует явного `{ context: undefined }`
 * в частом сценарии без runtime-контекста и допускает прямой happy path
 * для command и event flow. Это важно, потому что такой boilerplate не
 * несет полезной информации и только раздувает пользовательский код.
 * Также покрывается corner case с event emission, чтобы default работал
 * не только для команд, но и для второго основного server pipeline.
 */
test("should allow command execution and event emission without explicit empty runtime context", async () => {
  const ping = command("ping", {
    input: z.object({
      roomId: z.string().min(1)
    }),
    ack: z.object({
      ok: z.literal(true)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().min(1)
    })
  });
  const deliveries: unknown[] = [];
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [messageCreated] as const
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
      "message-created": (delivery) => {
        deliveries.push(delivery);
      }
    }
  });

  const ack = await runtime.executeCommand("ping", {
    roomId: "room-1"
  });

  await runtime.emitEvent("message-created", {
    text: "hello"
  });

  assert.deepEqual(ack, {
    ok: true
  });
  assert.equal(deliveries.length, 1);
});

/**
 * Проверяет, что join-операция в no-context runtime требует только те
 * данные, которые действительно нужны самому join flow, а не лишний
 * технический `context: undefined`. Это важно, потому что membership API
 * вызывается часто и быстро становится многословным без пользы.
 * Также покрывается corner case с последующим чтением membership, чтобы
 * default не ломал уже существующую модель хранения участников.
 */
test("should allow channel joins without explicit empty runtime context", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    })
  });

  const membership = await runtime.joinChannel("voice-room", {
    roomId: "room-1"
  }, {
    memberId: "user-1"
  });
  const members = runtime.listChannelMembers("voice-room", {
    roomId: "room-1"
  });

  assert.equal(membership.memberId, "user-1");
  assert.equal(members.length, 1);
});
