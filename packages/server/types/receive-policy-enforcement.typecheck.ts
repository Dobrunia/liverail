import { z } from "zod";

import {
  createContractRegistry,
  event,
  receivePolicy,
  type EventPayload,
  type ReceivePolicyContract
} from "@liverail/contracts";
import {
  createServerRuntime,
  type ServerEventRoute
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что receive policy enforcement принимает scoped
 * receive policy и сохраняет точные типы payload, route и runtime context.
 * Это важно, потому что delivery-level security должна работать поверх typed
 * event emission, а не размывать данные до `unknown`.
 * Также покрывается corner case с `emitEvent`, чтобы runtime требовал тот же
 * context shape, что и подключенные receive policy для конкретного события.
 */
const messageCreated = event("message-created", {
  payload: z.object({
    text: z.string()
  })
});
const registry = createContractRegistry({
  events: [messageCreated] as const
});
const canReceiveMessageCreated = receivePolicy<
  "can-receive-message-created",
  typeof messageCreated,
  { role: "member" | "guest" },
  ServerEventRoute
>("can-receive-message-created", {
  evaluate: (execution) => {
    type ShouldTypeReceivePolicyExecution = Assert<
      IsEqual<
        typeof execution,
        {
          readonly contract: typeof messageCreated;
          readonly name: "message-created";
          readonly payload: EventPayload<typeof messageCreated>;
          readonly route: ServerEventRoute;
          readonly context: { role: "member" | "guest" };
        }
      >
    >;

    return execution.context.role === "member";
  }
});
const runtime = createServerRuntime<{ role: "member" | "guest" }, typeof registry>(
  {
    registry,
    eventReceivePolicies: {
      "message-created": [canReceiveMessageCreated]
    },
    eventRouters: {
      "message-created": () => ({
        target: "socket-1"
      })
    },
    eventDeliverers: {
      "message-created": () => undefined
    }
  }
);

type ShouldAcceptTypedReceivePolicies = Assert<
  IsEqual<
    typeof canReceiveMessageCreated,
    ReceivePolicyContract<
      "can-receive-message-created",
      typeof messageCreated,
      { role: "member" | "guest" },
      ServerEventRoute
    >
  >
>;

const pendingDeliveries = runtime.emitEvent(
  "message-created",
  {
    text: "hello"
  },
  {
    context: {
      role: "member"
    }
  }
);

type ShouldReturnTypedDeliveriesAfterReceivePolicies = Assert<
  IsEqual<
    typeof pendingDeliveries,
    Promise<
      readonly {
        readonly contract: typeof messageCreated;
        readonly name: "message-created";
        readonly payload: EventPayload<typeof messageCreated>;
        readonly route: ServerEventRoute;
        readonly context: { role: "member" | "guest" };
      }[]
    >
  >
>;

runtime.emitEvent("message-created", {
  text: "hello"
}, {
  // @ts-expect-error receive policy enforcement must keep the runtime context shape
  context: {}
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
