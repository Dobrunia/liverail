import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  createContractRegistry,
  createRealtimeError
} from "@liverail/contracts";
import {
  createClientRuntime,
  type ClientTransportConnectionReceiver
} from "../src/index.ts";

/**
 * Проверяет, что client runtime публикует lifecycle-сигналы как отдельные
 * system events, а не заставляет UI вручную интерпретировать внутренний
 * connection state или смешивать его с domain event listener API.
 * Это важно, потому что служебные состояния соединения должны выходить
 * наружу через формализованный канал с явной маркировкой.
 * Также покрывается corner case с reconnect и terminal failure, чтобы
 * различались `connected`, `reconnect_started`, `reconnect_succeeded`,
 * `disconnected` и `connection_failed`.
 */
test("should publish client lifecycle transitions through the dedicated system event model", () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const seenEvents: string[] = [];
  const runtime = createClientRuntime({
    registry: createContractRegistry(),
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      }
    }
  });

  runtime.onSystemEvent("connected", (event) => {
    seenEvents.push(`connected:${event.payload.previousState ?? "none"}`);
  });
  runtime.onSystemEvent("disconnected", (event) => {
    seenEvents.push(`disconnected:${event.payload.previousState ?? "none"}`);
  });
  runtime.onSystemEvent("reconnect_started", (event) => {
    seenEvents.push(`reconnect_started:${event.payload.previousState ?? "none"}`);
  });
  runtime.onSystemEvent("reconnect_succeeded", (event) => {
    seenEvents.push(`reconnect_succeeded:${event.payload.previousState}`);
  });
  runtime.onSystemEvent("connection_failed", (event) => {
    seenEvents.push(`connection_failed:${event.payload.error.code}`);
  });

  connectionReceiver?.({
    status: "connected"
  });
  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "reconnecting"
  });
  connectionReceiver?.({
    status: "connected"
  });
  connectionReceiver?.({
    status: "failed",
    error: new Error("Dial failed.")
  });

  assert.deepEqual(seenEvents, [
    "connected:connecting",
    "disconnected:connected",
    "reconnect_started:disconnected",
    "reconnect_succeeded:reconnecting",
    "connection_failed:internal-error"
  ]);
});

/**
 * Проверяет, что неуспешный join в клиентском runtime репортится как
 * отдельный system event и остается отделенным от обычных domain events.
 * Это важно, потому что operational-ошибки подписки нужны UI и логике
 * восстановления соединения, но не должны маскироваться под бизнес-события.
 * Также покрывается corner case с уже нормализованной realtime-ошибкой,
 * чтобы system event сохранял официальный error model без повторной потери
 * кода и сообщения при пробросе из transport layer.
 */
test("should publish join failures through the dedicated system event model", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });
  const joinError = createRealtimeError({
    code: "join-denied",
    message: "Join denied."
  });
  const seenEvents: string[] = [];
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        throw joinError;
      }
    }
  });

  runtime.onSystemEvent("join_failed", (event) => {
    seenEvents.push(
      `${event.payload.channelName}:${String((event.payload.key as { roomId: string }).roomId)}:${event.payload.error.code}`
    );
  });

  await assert.rejects(
    runtime.subscribeChannel("voice-room", {
      roomId: "  room-1  "
    }),
    (error) => error === joinError
  );

  assert.deepEqual(seenEvents, [
    "voice-room:room-1:join-denied"
  ]);
});
