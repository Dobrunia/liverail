import { z } from "zod";

import {
  createContractRegistry,
  event,
  parseEventPayload
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что parseEventPayload возвращает output-тип
 * именно payload schema, а не `unknown`.
 * Это важно, потому что event contract должен задавать точную форму серверного
 * события для всех downstream runtime-слоев.
 * Также учитывается corner case с `coerce.date()`, где входной и выходной типы различаются.
 */
type ShouldInferTypedEventPayloadFromSchema = Assert<
  IsEqual<
    typeof parsedPayload,
    {
      roomId: string;
      joinedAt: Date;
    }
  >
>;

/**
 * Проверяет на уровне компиляции, что registry сохраняет строгую payload-модель
 * при lookup события по имени.
 * Это важно, потому что runtime будет чаще работать именно через registry,
 * а не через исходную локальную константу с событием.
 * Дополнительно покрывается edge case с пустым событием на `z.void()`.
 */
type ShouldPreservePayloadContractsInsideRegistry = Assert<
  IsEqual<typeof parsedRegistryPayload, void>
>;

const memberJoinedEvent = event("member-joined", {
  payload: z.object({
    roomId: z.string(),
    joinedAt: z.coerce.date()
  })
});

const heartbeatEvent = event("heartbeat", {
  payload: z.void()
});

const registry = createContractRegistry({
  events: [memberJoinedEvent, heartbeatEvent] as const
});

const parsedPayload = parseEventPayload(memberJoinedEvent, {
  roomId: "room-1",
  joinedAt: "2026-03-13T12:00:00.000Z"
});

const parsedRegistryPayload = parseEventPayload(
  registry.events.byName.heartbeat,
  undefined
);

// @ts-expect-error event contracts must have a payload schema
event("missing-payload", {});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
