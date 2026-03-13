import { z } from "zod";

import {
  command,
  createContractRegistry,
  type CommandAck,
  type CommandInput
} from "@liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что typed command client API сохраняет точные
 * типы input и ack конкретной команды и не размывает transport request shape.
 * Это важно, потому что клиентский command flow должен быть контрактным так же,
 * как и серверный pipeline, без ручных generic-аннотаций и cast-ов.
 * Также покрывается corner case с асинхронным executeCommand, чтобы итоговый
 * Promise резолвился в точный ack конкретной команды, а не в общий объект.
 */
const setVolume = command("set-volume", {
  input: z.object({
    roomId: z.string(),
    level: z.number().int().min(0).max(100)
  }),
  ack: z.object({
    appliedLevel: z.number().int().min(0).max(100)
  })
});
const runtime = createClientRuntime({
  registry: createContractRegistry({
    commands: [setVolume] as const
  }),
  transport: {
    sendCommand(request) {
      type ShouldTypeTransportCommandRequest = Assert<
        IsEqual<
          typeof request,
          {
            readonly name: string;
            readonly input: unknown;
          }
        >
      >;

      return {
        appliedLevel: 42
      };
    }
  }
});

const pendingAck = runtime.executeCommand("set-volume", {
  roomId: "room-1",
  level: 42
});

type ShouldReturnTypedAckPromise = Assert<
  IsEqual<typeof pendingAck, Promise<CommandAck<typeof setVolume>>>
>;

type ShouldKeepTypedCommandInput = Assert<
  IsEqual<CommandInput<typeof setVolume>, { roomId: string; level: number }>
>;

runtime.executeCommand("set-volume", {
  roomId: "room-1",
  // @ts-expect-error command client API must enforce the known input schema
  level: "invalid"
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
