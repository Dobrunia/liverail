import { cloneDeep, deepFreeze } from "./object.ts";

/**
 * Допустимые виды базовых realtime-примитивов.
 */
export type ContractPrimitiveKind = "command" | "event" | "channel" | "policy";

/**
 * Произвольные метаданные, сопровождающие объявление контракта.
 */
export type ContractMetadata = Readonly<Record<string, unknown>>;

/**
 * Общие опции для декларативных contract-примитивов.
 */
export interface ContractPrimitiveOptions {
  /**
   * Краткое человеко-читаемое описание назначения контракта.
   */
  readonly description?: string;

  /**
   * Дополнительные read-only метаданные, полезные для runtime и tooling.
   */
  readonly metadata?: ContractMetadata;
}

/**
 * Базовая форма любого декларативного realtime-примитива.
 */
export interface ContractPrimitive<
  TKind extends ContractPrimitiveKind,
  TName extends string = string
> {
  /**
   * Тип контрактной сущности.
   */
  readonly kind: TKind;

  /**
   * Уникальное имя контрактной сущности.
   */
  readonly name: TName;

  /**
   * Необязательное описание назначения контракта.
   */
  readonly description?: string;

  /**
   * Необязательные пользовательские метаданные.
   */
  readonly metadata?: ContractMetadata;
}

/**
 * Создает базовую форму контракта и приводит ее к единой read-only модели.
 */
export function createPrimitive<
  TKind extends ContractPrimitiveKind,
  TName extends string,
  TExtensions extends Record<string, unknown> = {}
>(
  kind: TKind,
  name: TName,
  options: ContractPrimitiveOptions,
  extensions: TExtensions = {} as TExtensions
): ContractPrimitive<TKind, TName> & Readonly<Partial<TExtensions>> {
  assertPrimitiveName(kind, name);

  const contract: Record<string, unknown> & {
    kind: TKind;
    name: TName;
    description?: string;
    metadata?: ContractMetadata;
  } = {
    kind,
    name
  };

  if (options.description !== undefined) {
    contract.description = options.description;
  }

  if (options.metadata !== undefined) {
    contract.metadata = deepFreeze(cloneDeep(options.metadata));
  }

  for (const [key, value] of Object.entries(extensions)) {
    if (value !== undefined) {
      contract[key] = value;
    }
  }

  return deepFreeze(contract) as ContractPrimitive<TKind, TName> &
    Readonly<Partial<TExtensions>>;
}

/**
 * Валидирует имя контрактной сущности и отсекает пустые объявления.
 */
function assertPrimitiveName(kind: ContractPrimitiveKind, name: string): void {
  if (name.trim().length === 0) {
    throw new TypeError(
      `${kind[0]!.toUpperCase()}${kind.slice(1)} contract name must not be empty.`
    );
  }
}
