import { z } from "zod";

import {
  createContractRegistry,
  event,
  type EventPayload
} from "@dobrunia-liverail/contracts";
import {
  createServerRuntime,
  type ServerEventRecipient
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что event pipeline сохраняет точные типы payload,
 * route и delivery для конкретного event contract.
 * Это важно, потому что server push должен оставаться contract-driven не только
 * в runtime, но и в authoring-time подсказках для route/deliver логики.
 * Также покрывается corner case с emitEvent, чтобы его Promise возвращал
 * typed delivery-список конкретного события, а не абстрактный `unknown[]`.
 */
const memberJoined = event("member-joined", {
  payload: z.object({
    roomId: z.string(),
    joinedAt: z.date()
  })
});
const registry = createContractRegistry({
  events: [memberJoined] as const
});
const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
  registry,
  eventRouters: {
    "member-joined": (emission) => {
      type ShouldTypeEmission = Assert<
        IsEqual<
          typeof emission,
          {
            readonly contract: typeof memberJoined;
            readonly name: "member-joined";
            readonly payload: EventPayload<typeof memberJoined>;
            readonly context: { requestId: string };
          }
        >
      >;

      return {
        target: `room:${emission.payload.roomId}`
      };
    }
  },
  eventDeliverers: {
    "member-joined": (delivery) => {
      type ShouldTypeDelivery = Assert<
        IsEqual<
          typeof delivery,
          {
            readonly contract: typeof memberJoined;
            readonly name: "member-joined";
            readonly payload: EventPayload<typeof memberJoined>;
            readonly context: { requestId: string };
            readonly route: {
              readonly target: string;
              readonly metadata?: Readonly<Record<string, unknown>>;
            };
            readonly recipient?: ServerEventRecipient<{ requestId: string }>;
          }
        >
      >;

      void delivery.route.target.length;
    }
  }
});

const pendingDeliveries = runtime.emitEvent(
  "member-joined",
  {
    roomId: "room-1",
    joinedAt: new Date("2026-03-13T12:00:00.000Z")
  },
  {
    context: {
      requestId: "req-1"
    }
  }
);

type ShouldReturnTypedEventDeliveries = Assert<
  IsEqual<
    typeof pendingDeliveries,
    Promise<
      readonly {
        readonly contract: typeof memberJoined;
        readonly name: "member-joined";
        readonly payload: EventPayload<typeof memberJoined>;
        readonly context: { requestId: string };
        readonly route: {
          readonly target: string;
          readonly metadata?: Readonly<Record<string, unknown>>;
        };
        readonly recipient?: ServerEventRecipient<{ requestId: string }>;
      }[]
    >
  >
>;

// @ts-expect-error event pipeline must enforce the known payload schema
runtime.emitEvent("member-joined", { roomId: "room-1", joinedAt: "invalid" }, {
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
