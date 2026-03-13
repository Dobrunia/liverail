import { z } from "zod";

import {
  channel,
  createContractRegistry
} from "@liverail/contracts";
import {
  createClientRuntime,
  type ClientTransportConnectionEvent,
  type ClientTransportConnectionReceiver
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что reconnect-layer использует явные transport
 * connection events и не размывает их до произвольных строковых маркеров.
 * Это важно, потому что resubscription flow должен быть типизирован так же
 * строго, как и остальной client runtime, без raw lifecycle-signals.
 * Также покрывается corner case с bindConnection, чтобы transport receiver
 * принимал только официальный набор connection statuses.
 */
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
createClientRuntime({
  registry: createContractRegistry({
    channels: [voiceRoom] as const
  }),
  transport: {
    bindConnection(receiver) {
      type ShouldTypeConnectionReceiver = Assert<
        IsEqual<typeof receiver, ClientTransportConnectionReceiver>
      >;

      receiver({
        status: "connected"
      } satisfies ClientTransportConnectionEvent);
    },
    subscribeChannel() {
      return undefined;
    },
    unsubscribeChannel() {
      return undefined;
    }
  }
});

const event: ClientTransportConnectionEvent = {
  status: "disconnected"
};

event.status;

const invalidEvent: ClientTransportConnectionEvent = {
  // @ts-expect-error reconnect flow must reject unknown lifecycle statuses
  status: "reconnected"
};

invalidEvent;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
