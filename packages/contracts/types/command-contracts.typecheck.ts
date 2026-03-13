import { z } from "zod";

import {
  command,
  createContractRegistry,
  parseCommandAck
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что parseCommandAck возвращает output-тип
 * именно ack-схемы, а не input или `unknown`.
 * Это важно, потому что command contract должен строго разделять вход команды
 * и подтверждение выполнения на уровне типов.
 * Также учитывается corner case с `coerce.date()`, где вход и выход ack различаются.
 */
type ShouldInferTypedAckOutputFromAckSchema = Assert<
  IsEqual<
    typeof parsedAck,
    {
      acceptedAt: Date;
      appliedLevel: number;
    }
  >
>;

/**
 * Проверяет на уровне компиляции, что registry не теряет строгий ack-контракт
 * при lookup по имени команды.
 * Это важно, потому что дальнейший runtime будет получать command definitions
 * из registry, а не только из локальных переменных.
 * Дополнительно покрывается edge case с пустыми командами, которые должны
 * оставаться допустимыми только через явные `z.void()` schema.
 */
type ShouldPreserveAckContractsInsideRegistry = Assert<
  IsEqual<typeof parsedRegistryAck, void>
>;

const setVolumeCommand = command("set-volume", {
  input: z.object({
    roomId: z.string(),
    level: z.coerce.number()
  }),
  ack: z.object({
    acceptedAt: z.coerce.date(),
    appliedLevel: z.number()
  })
});

const pingCommand = command("ping", {
  input: z.void(),
  ack: z.void()
});

const registry = createContractRegistry({
  commands: [setVolumeCommand, pingCommand] as const
});

const parsedAck = parseCommandAck(setVolumeCommand, {
  acceptedAt: "2026-03-13T12:00:00.000Z",
  appliedLevel: 42
});

const parsedRegistryAck = parseCommandAck(registry.commands.byName.ping, undefined);

// @ts-expect-error command contracts must have an input schema
command("missing-input", {
  ack: z.void()
});

// @ts-expect-error command contracts must have an ack schema
command("missing-ack", {
  input: z.void()
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
