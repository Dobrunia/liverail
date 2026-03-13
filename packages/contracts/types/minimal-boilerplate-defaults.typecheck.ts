import {
  command,
  type CommandAck,
  type CommandInput,
  voidSchema
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что публичный `voidSchema` сразу совместим
 * с command contracts и не требует отдельного импорта `zod` для базового
 * no-payload сценария. Это важно, потому что ergonomic default должен
 * сокращать и runtime-код, и authoring-time boilerplate одновременно.
 * Также покрывается corner case с выводом input/ack типов, чтобы они не
 * деградировали в `unknown` после перехода на публичный helper schema.
 */
const ping = command("ping", {
  input: voidSchema,
  ack: voidSchema
});

const input: CommandInput<typeof ping> = undefined;
const ack: CommandAck<typeof ping> = undefined;

input satisfies void;
ack satisfies void;
