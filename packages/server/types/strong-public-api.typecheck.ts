import { z } from "zod";

import {
  command,
  createContractRegistry,
  defineCommands,
  type CommandAck,
  type CommandInput
} from "@dobrunia-liverail/contracts";
import {
  defineServerRuntime,
  type ServerCommandExecution
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что strongly typed server runtime helper умеет
 * выводить runtime context из публичных handler-типов без явного generic на runtime.
 * Это важно, потому что authoring-time API должен уменьшать типовой шум и не
 * заставлять пользователя дублировать context generic рядом с registry generic.
 * Также покрывается corner case с executeCommand, чтобы итоговая сигнатура
 * метода использовала уже выведенный context и точный ack конкретной команды.
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
const runtime = defineServerRuntime({
  registry: createContractRegistry({
    commands: defineCommands(setVolume)
  }),
  commandHandlers: {
    "set-volume": (
      execution: ServerCommandExecution<typeof setVolume, { requestId: string }>
    ) => {
      type ShouldTypeHandlerExecution = Assert<
        IsEqual<
          typeof execution,
          {
            readonly contract: typeof setVolume;
            readonly name: "set-volume";
            readonly input: CommandInput<typeof setVolume>;
            readonly context: { requestId: string };
          }
        >
      >;

      return {
        appliedLevel: execution.input.level
      };
    }
  }
});
const pendingAck = runtime.executeCommand(
  "set-volume",
  {
    roomId: "room-1",
    level: 42
  },
  {
    context: {
      requestId: "req-1"
    }
  }
);

type ShouldReturnTypedAckPromise = Assert<
  IsEqual<typeof pendingAck, Promise<CommandAck<typeof setVolume>>>
>;

runtime.executeCommand("set-volume", {
  roomId: "room-1",
  level: 42
}, {
  // @ts-expect-error strongly typed runtime helper must infer the handler context shape
  context: {}
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
