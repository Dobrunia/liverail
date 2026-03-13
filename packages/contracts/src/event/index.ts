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
 * Декларативный контракт server-to-client события.
 */
export interface EventContract<
  TName extends string = string,
  TPayloadSchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitive<"event", TName> {
  /**
   * Schema payload серверного события.
   */
  readonly payload: TPayloadSchema;
}

/**
 * Получает нормализованный тип payload события.
 */
export type EventPayload<TEvent extends EventContract = EventContract> =
  ResolveSchemaOutput<TEvent["payload"]>;

/**
 * Типизированный контекст обработки server-to-client события.
 */
export interface EventContext<
  TEvent extends EventContract = EventContract,
  TRuntimeContext extends RuntimeContext = RuntimeContext
> {
  /**
   * Контракт текущего события.
   */
  readonly contract: TEvent;

  /**
   * Имя события как стабильный dispatch-ключ.
   */
  readonly name: TEvent["name"];

  /**
   * Нормализованный payload события.
   */
  readonly payload: EventPayload<TEvent>;

  /**
   * Runtime-контекст доставки события.
   */
  readonly context: TRuntimeContext;
}

/**
 * Опции декларативного события.
 */
export interface EventOptions<
  TPayloadSchema extends AnyContractSchema = AnyContractSchema
> extends ContractPrimitiveOptions {
  /**
   * Schema payload события.
   */
  readonly payload: TPayloadSchema;
}

/**
 * Создает декларативный event-примитив с устойчивой неизменяемой формой.
 */
export function event<
  TName extends string,
  TPayloadSchema extends AnyContractSchema
>(
  name: TName,
  options: EventOptions<TPayloadSchema>
): EventContract<TName, TPayloadSchema> {
  if (options.payload === undefined) {
    throw new TypeError("Event contracts must declare a payload schema.");
  }

  assertContractSchema(options.payload, "event payload");

  return createPrimitive("event", name, options, {
    payload: options.payload
  }) as EventContract<TName, TPayloadSchema>;
}

/**
 * Валидирует и нормализует payload события по его Zod-схеме.
 */
export function parseEventPayload<TEvent extends EventContract>(
  contract: TEvent,
  payload: ResolveSchemaInput<TEvent["payload"]>
): EventPayload<TEvent> {
  return parseSchemaValue(
    contract.payload,
    payload,
    "invalid-event-payload"
  ) as EventPayload<TEvent>;
}
