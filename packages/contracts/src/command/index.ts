import type { RuntimeContext } from "../shared/runtime.ts";
import {
  createPrimitive,
  type ContractPrimitive,
  type ContractPrimitiveOptions
} from "../shared/primitives.ts";
import {
  assertContractSchema,
  parseSchemaValue,
  type AnyContractSchema,
  type ResolveSchemaInput,
  type ResolveSchemaOutput
} from "../shared/schema.ts";

/**
 * Декларативный контракт команды.
 */
export interface CommandContract<
  TName extends string = string,
  TInputSchema extends AnyContractSchema = AnyContractSchema,
  TAckSchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitive<"command", TName> {
  /**
   * Schema входных данных команды.
   */
  readonly input: TInputSchema;

  /**
   * Schema подтверждения выполнения команды.
   */
  readonly ack: TAckSchema;
}

/**
 * Получает нормализованный тип входных данных команды.
 */
export type CommandInput<TCommand extends CommandContract = CommandContract> =
  ResolveSchemaOutput<TCommand["input"]>;

/**
 * Получает нормализованный тип ack-ответа команды.
 */
export type CommandAck<TCommand extends CommandContract = CommandContract> =
  ResolveSchemaOutput<TCommand["ack"]>;

/**
 * Типизированный контекст исполнения команды.
 */
export interface CommandContext<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext extends RuntimeContext = RuntimeContext
> {
  /**
   * Контракт исполняемой команды.
   */
  readonly contract: TCommand;

  /**
   * Имя команды как стабильный идентификатор dispatch.
   */
  readonly name: TCommand["name"];

  /**
   * Нормализованный вход команды после schema-driven преобразования.
   */
  readonly input: CommandInput<TCommand>;

  /**
   * Runtime-контекст текущего вызова.
   */
  readonly context: TRuntimeContext;
}

/**
 * Опции декларативной команды с общими schema-ссылками.
 */
export interface CommandOptions<
  TInputSchema extends AnyContractSchema = AnyContractSchema,
  TAckSchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitiveOptions {
  /**
   * Schema входных данных команды.
   */
  readonly input: TInputSchema;

  /**
   * Schema ack-ответа команды.
   */
  readonly ack: TAckSchema;
}

/**
 * Создает декларативный command-примитив с устойчивой неизменяемой формой.
 */
export function command<
  TName extends string,
  TInputSchema extends AnyContractSchema,
  TAckSchema extends AnyContractSchema
>(
  name: TName,
  options: CommandOptions<TInputSchema, TAckSchema>
): CommandContract<TName, TInputSchema, TAckSchema> {
  if (options.input === undefined) {
    throw new TypeError("Command contracts must declare an input schema.");
  }

  if (options.ack === undefined) {
    throw new TypeError("Command contracts must declare an ack schema.");
  }

  assertContractSchema(options.input, "command input");
  assertContractSchema(options.ack, "command ack");

  return createPrimitive("command", name, options, {
    input: options.input,
    ack: options.ack
  }) as CommandContract<TName, TInputSchema, TAckSchema>;
}

/**
 * Валидирует и нормализует input команды по ее Zod-схеме.
 */
export function parseCommandInput<TCommand extends CommandContract>(
  contract: TCommand,
  input: ResolveSchemaInput<TCommand["input"]>
): CommandInput<TCommand> {
  return parseSchemaValue(
    contract.input,
    input,
    "invalid-input"
  ) as CommandInput<TCommand>;
}

/**
 * Валидирует и нормализует ack команды по ее Zod-схеме.
 */
export function parseCommandAck<TCommand extends CommandContract>(
  contract: TCommand,
  ack: ResolveSchemaInput<TCommand["ack"]>
): CommandAck<TCommand> {
  return parseSchemaValue(
    contract.ack,
    ack,
    "invalid-ack"
  ) as CommandAck<TCommand>;
}
