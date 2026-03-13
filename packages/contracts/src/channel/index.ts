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

  /**
   * Создает конкретный typed instance канала через официальный helper.
   */
  of(
    key: ResolveSchemaInput<TKeySchema>
  ): ChannelInstance<ChannelContract<TName, TKeySchema>>;
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

  /**
   * Канонический сериализованный идентификатор channel instance.
   */
  readonly id: string;
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

  const primitive = createPrimitive("channel", name, options, {
    key: options.key
  }) as ChannelContract<TName, TKeySchema>;

  return deepFreeze({
    ...primitive,
    of(key: ResolveSchemaInput<TKeySchema>) {
      return createChannelInstance(primitive, key);
    }
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
  const parsedKey = parseChannelKey(contract, key);

  return deepFreeze({
    contract,
    name: contract.name,
    key: parsedKey,
    id: stringifyChannelInstance(contract.name, parsedKey)
  }) as ChannelInstance<TChannel>;
}

/**
 * Сериализует channel instance или его нормализованные части в один
 * канонический строковый идентификатор.
 */
export function stringifyChannelInstance<TChannel extends ChannelContract>(
  instance: ChannelInstance<TChannel>
): string;
export function stringifyChannelInstance(
  channelName: string,
  key: ChannelKey<ChannelContract>
): string;
export function stringifyChannelInstance(
  input: string | ChannelInstance,
  key?: ChannelKey<ChannelContract>
): string {
  if (typeof input === "string") {
    return `${input}:${JSON.stringify(key)}`;
  }

  return `${input.name}:${JSON.stringify(input.key)}`;
}

/**
 * Разбирает канонический channel instance id и восстанавливает typed instance.
 */
export function parseChannelInstance<TChannel extends ChannelContract>(
  contract: TChannel,
  value: string
): ChannelInstance<TChannel> {
  const separatorIndex = value.indexOf(":");

  if (separatorIndex <= 0) {
    throw new TypeError("Channel instance id must contain a channel name and key.");
  }

  const channelName = value.slice(0, separatorIndex);
  const serializedKey = value.slice(separatorIndex + 1);

  if (channelName !== contract.name) {
    throw new TypeError(
      `Channel instance id belongs to another contract. Expected "${contract.name}", received "${channelName}".`
    );
  }

  try {
    return createChannelInstance(
      contract,
      JSON.parse(serializedKey) as ResolveSchemaInput<TChannel["key"]>
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new TypeError(`Channel instance id has an invalid serialized key: "${value}".`);
    }

    throw error;
  }
}

/**
 * Проверяет равенство двух channel instances по каноническому идентификатору.
 */
export function isSameChannelInstance(
  left: ChannelInstance,
  right: ChannelInstance
): boolean {
  return left.id === right.id;
}
