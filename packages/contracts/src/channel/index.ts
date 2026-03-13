import type { RuntimeContext } from "../shared/runtime.ts";
import { deepFreeze } from "../shared/object.ts";
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
 * Декларативный контракт канала подписки.
 */
export interface ChannelContract<
  TName extends string = string,
  TKeySchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitive<"channel", TName> {
  /**
   * Schema ключа конкретного instance канала.
   */
  readonly key: TKeySchema;
}

/**
 * Получает нормализованный тип ключа канала.
 */
export type ChannelKey<TChannel extends ChannelContract = ChannelContract> =
  ResolveSchemaOutput<TChannel["key"]>;

/**
 * Конкретный instance канала с уже валидированным ключом.
 */
export interface ChannelInstance<TChannel extends ChannelContract = ChannelContract> {
  /**
   * Шаблонный контракт канала, из которого создан instance.
   */
  readonly contract: TChannel;

  /**
   * Имя channel template.
   */
  readonly name: TChannel["name"];

  /**
   * Валидированный ключ конкретного channel instance.
   */
  readonly key: ChannelKey<TChannel>;
}

/**
 * Типизированный контекст работы с channel instance.
 */
export interface ChannelContext<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext extends RuntimeContext = RuntimeContext
> {
  /**
   * Контракт канала.
   */
  readonly contract: TChannel;

  /**
   * Имя канала как стабильный template identifier.
   */
  readonly name: TChannel["name"];

  /**
   * Нормализованный ключ channel instance.
   */
  readonly key: ChannelKey<TChannel>;

  /**
   * Runtime-контекст join/leave/subscription операции.
   */
  readonly context: TRuntimeContext;
}

/**
 * Опции декларативного канала.
 */
export interface ChannelOptions<
  TKeySchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitiveOptions {
  /**
   * Schema ключа channel instance.
   */
  readonly key: TKeySchema;
}

/**
 * Создает декларативный channel-примитив с устойчивой неизменяемой формой.
 */
export function channel<
  TName extends string,
  TKeySchema extends AnyContractSchema
>(
  name: TName,
  options: ChannelOptions<TKeySchema>
): ChannelContract<TName, TKeySchema> {
  if (options.key === undefined) {
    throw new TypeError("Channel contracts must declare a key schema.");
  }

  assertContractSchema(options.key, "channel key");

  return createPrimitive("channel", name, options, {
    key: options.key
  }) as ChannelContract<TName, TKeySchema>;
}

/**
 * Валидирует и нормализует ключ channel instance по его Zod-схеме.
 */
export function parseChannelKey<TChannel extends ChannelContract>(
  contract: TChannel,
  key: ResolveSchemaInput<TChannel["key"]>
): ChannelKey<TChannel> {
  return parseSchemaValue(
    contract.key,
    key,
    "invalid-channel-key"
  ) as ChannelKey<TChannel>;
}

/**
 * Создает конкретный channel instance из шаблонного контракта и сырого ключа.
 */
export function createChannelInstance<TChannel extends ChannelContract>(
  contract: TChannel,
  key: ResolveSchemaInput<TChannel["key"]>
): ChannelInstance<TChannel> {
  return deepFreeze({
    contract,
    name: contract.name,
    key: parseChannelKey(contract, key)
  }) as ChannelInstance<TChannel>;
}
