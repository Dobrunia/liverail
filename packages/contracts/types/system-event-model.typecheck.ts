import {
  createSystemEvent,
  type SystemConnectionLifecycleState,
  type SystemEvent,
  type SystemEventName,
  type SystemEventPayload
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что системные realtime-события имеют
 * собственную typed-модель по имени события и не теряют payload shape
 * при создании через официальный helper. Это важно, потому что client
 * runtime будет публиковать lifecycle и operational-сигналы поверх этого
 * контракта, а пользовательский код не должен скатываться в `unknown`.
 * Также покрывается corner case с connection failure payload, чтобы
 * unified realtime error model оставался частью typed system event API.
 */
const connected = createSystemEvent("connected", {
  state: "connected",
  previousState: "connecting"
});
const joinFailed = createSystemEvent("join_failed", {
  channelName: "voice-room",
  key: {
    roomId: "room-1"
  },
  error: {
    name: "LiveRailRealtimeError",
    code: "join-denied",
    message: "Join denied."
  }
});
const lifecycleState: SystemConnectionLifecycleState = connected.payload.state;
const systemEventName: SystemEventName = joinFailed.name;
const connectedPayload: SystemEventPayload<"connected"> = connected.payload;
const systemEvent: SystemEvent<"join_failed"> = joinFailed;

lifecycleState;
systemEventName;
connectedPayload.previousState;
systemEvent.payload.error.code;

createSystemEvent(
  // @ts-expect-error official system event model must reject unknown names
  "message-created",
  {}
);
