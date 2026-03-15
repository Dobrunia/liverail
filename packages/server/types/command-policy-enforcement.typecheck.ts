import { z } from "zod";

import {
  command,
  commandPolicy,
  createContractRegistry,
  type CommandAck,
  type CommandInput,
  type CommandPolicyContract
} from "dobrunia-liverail-contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что command policy enforcement принимает scoped
 * command policy и сохраняет точные типы input, contract и runtime context.
 * Это важно, потому что command access layer должен быть централизованным,
 * но при этом не терять типы конкретной команды внутри policy evaluator.
 * Также покрывается corner case с `executeCommand`, чтобы runtime требовал
 * тот же context shape, что и подключенные command policy.
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
const canSetVolume = commandPolicy<
  "can-set-volume",
  typeof setVolume,
  { role: "admin" | "user" }
>("can-set-volume", {
  evaluate: (execution) => {
    type ShouldTypeCommandPolicyExecution = Assert<
      IsEqual<
        typeof execution,
        {
          readonly contract: typeof setVolume;
          readonly name: "set-volume";
          readonly input: CommandInput<typeof setVolume>;
          readonly context: { role: "admin" | "user" };
        }
      >
    >;

    return execution.context.role === "admin";
  }
});
const runtime = createServerRuntime<{ role: "admin" | "user" }, typeof registry>(
  {
    registry,
    commandPolicies: {
      "set-volume": [canSetVolume]
    },
    commandHandlers: {
      "set-volume": ({ input }) => ({
        appliedLevel: input.level
      })
    }
  }
);

type ShouldAcceptTypedCommandPolicies = Assert<
  IsEqual<
    typeof canSetVolume,
    CommandPolicyContract<
      "can-set-volume",
      typeof setVolume,
      { role: "admin" | "user" }
    >
  >
>;

const pendingAck = runtime.executeCommand(
  "set-volume",
  {
    roomId: "room-1",
    level: 42
  },
  {
    context: {
      role: "admin"
    }
  }
);

type ShouldReturnTypedAckAfterCommandPolicies = Assert<
  IsEqual<typeof pendingAck, Promise<CommandAck<typeof setVolume>>>
>;

runtime.executeCommand("set-volume", {
  roomId: "room-1",
  level: 42
}, {
  // @ts-expect-error command policy enforcement must keep the runtime context shape
  context: {}
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
