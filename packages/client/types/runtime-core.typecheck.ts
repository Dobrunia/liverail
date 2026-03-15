import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  type ChannelContract,
  type CommandContract,
  type EventContract
} from "@dobrunia-liverail/contracts";
import { createClientRuntime, type ClientTransportEvent } from "../src/index.js";

/**
 * Проверяет на уровне типов, что client runtime core сохраняет точные literal
 * имена contracts и типизирует transport event binding без ручных cast-ов.
 * Это важно, потому что следующий слой client API должен строиться поверх
 * typed runtime lookup и typed transport binding, а не поверх `unknown`.
 * Также покрывается corner case с неизвестным строковым именем, чтобы fallback
 * тип оставался безопасным и не маскировался под зарегистрированный contract.
 */
const ping = command("ping", {
  input: z.void(),
  ack: z.void()
});
const heartbeat = event("heartbeat", {
  payload: z.object({
    sentAt: z.date()
  })
});
const globalChannel = channel("global", {
  key: z.void()
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    commands: [ping] as const,
    events: [heartbeat] as const,
    channels: [globalChannel] as const
  }),
  transport: {
    bindEvents(receiver) {
      type ShouldTypeTransportReceiver = Assert<
        IsEqual<
          Parameters<typeof receiver>[0],
          ClientTransportEvent
        >
      >;

      receiver({
        name: "heartbeat",
        payload: {
          sentAt: new Date("2026-03-13T12:00:00.000Z")
        },
        route: {
          target: "direct"
        }
      });

      return () => undefined;
    }
  }
});

const resolvedPing = runtime.resolveCommand("ping");
const resolvedHeartbeat = runtime.resolveEvent("heartbeat");
const resolvedGlobalChannel = runtime.resolveChannel("global");
const unknownCommand = runtime.resolveCommand("unknown-command" as string);

type ShouldResolveRegisteredClientContractsPrecisely = Assert<
  IsEqual<typeof resolvedPing, typeof ping> &
    IsEqual<typeof resolvedHeartbeat, typeof heartbeat> &
    IsEqual<typeof resolvedGlobalChannel, typeof globalChannel> &
    IsEqual<typeof unknownCommand, CommandContract | undefined>
>;

type ShouldExposeBaseClientContractFallbacks = Assert<
  IsEqual<ReturnType<typeof runtime.resolveCommand>, CommandContract | undefined> &
    IsEqual<ReturnType<typeof runtime.resolveEvent>, EventContract | undefined> &
    IsEqual<ReturnType<typeof runtime.resolveChannel>, ChannelContract | undefined>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
