import {
  z,
  type input as ZodInput,
  type output as ZodOutput,
  type ZodType
} from "zod";

import type { RealtimeValidationErrorCode } from "../errors/index.ts";
import { normalizeValidationError } from "../errors/index.ts";
import { describeDiagnosticValue } from "./diagnostics.ts";
import { isObjectLike } from "./object.ts";

/**
 * Общий тип Zod-схемы, используемой одновременно для runtime validation
 * и type inference.
 */
export type ContractSchema<TOutput = unknown, TInput = TOutput> = ZodType<
  TOutput,
  TInput
>;

/**
 * Общий тип schema-ссылки, пригодный для всех видов контрактов.
 */
export type AnyContractSchema = ZodType;

/**
 * Выводит входной тип schema.
 */
export type InferSchemaInput<TSchema> = TSchema extends AnyContractSchema
  ? ZodInput<TSchema>
  : unknown;

/**
 * Выводит нормализованный выходной тип schema.
 */
export type InferSchemaOutput<TSchema> = TSchema extends AnyContractSchema
  ? ZodOutput<TSchema>
  : unknown;

/**
 * Нормализует входной тип schema с учетом отсутствующего значения.
 */
export type ResolveSchemaInput<TSchema> = [Exclude<TSchema, undefined>] extends [never]
  ? unknown
  : InferSchemaInput<Exclude<TSchema, undefined>>;

/**
 * Нормализует выходной тип schema с учетом отсутствующего значения.
 */
export type ResolveSchemaOutput<TSchema> =
  [Exclude<TSchema, undefined>] extends [never]
    ? unknown
    : InferSchemaOutput<Exclude<TSchema, undefined>>;

/**
 * Официальная schema для самых частых no-payload сценариев без ручного
 * импорта `z.void()` в пользовательском коде.
 */
export const voidSchema = z.void();

/**
 * Проверяет, что переданная schema совместима с Zod runtime API.
 */
export function assertContractSchema(
  schema: unknown,
  schemaName: string
): asserts schema is AnyContractSchema | undefined {
  if (schema === undefined) {
    return;
  }

  if (!isContractSchema(schema)) {
    throw new TypeError(
      `Contract ${schemaName} schema must be a Zod schema. Received: ${describeDiagnosticValue(schema)}.`
    );
  }
}

/**
 * Валидирует произвольное значение через schema и возвращает нормализованный
 * результат. При отсутствии schema возвращает исходное значение как есть.
 */
export function parseSchemaValue<TSchema extends AnyContractSchema | undefined>(
  schema: TSchema,
  value: ResolveSchemaInput<TSchema>,
  errorCode?: RealtimeValidationErrorCode
): ResolveSchemaOutput<TSchema> {
  if (schema === undefined) {
    return value as ResolveSchemaOutput<TSchema>;
  }

  try {
    return schema.parse(value) as ResolveSchemaOutput<TSchema>;
  } catch (error) {
    if (errorCode === undefined) {
      throw error;
    }

    throw normalizeValidationError(error, {
      code: errorCode
    });
  }
}

function isContractSchema(value: unknown): value is AnyContractSchema {
  return (
    isObjectLike(value) &&
    typeof value.parse === "function" &&
    typeof value.safeParse === "function"
  );
}
