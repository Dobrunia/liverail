import { z } from "zod";

import {
  command,
  createContractRegistry,
  type CommandAck,
  type CommandInput
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что command pipeline сохраняет точные типы input,
 * ack и server context для handler-а, authorizer-а и результата executeCommand.
 * Это важно, потому что ценность server runtime здесь именно в том, что весь
 * pipeline остается контрактным и не деградирует в `unknown`.
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
const registry = createContractRegistry({
  commands: [setVolume] as const
});
const runtime = createServerRuntime<{ requestId: string }, typeof registry>({
  registry,
  commandAuthorizers: {
    "set-volume": (execution) => {
      type ShouldTypeAuthorizerExecution = Assert<
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

      return execution.context.requestId.length > 0;
    }
  },
  commandHandlers: {
    "set-volume": (execution) => {
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

// @ts-expect-error command pipeline must enforce the known input schema
runtime.executeCommand("set-volume", { roomId: "room-1", level: "invalid" }, {
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
