import { ZodError } from "zod";

import { cloneDeep, deepFreeze, isObjectLike } from "../shared/object.ts";

/**
 * Официальный список кодов ошибок, который разделяют все слои библиотеки.
 */
export const REALTIME_ERROR_CODES = Object.freeze([
  "invalid-input",
  "invalid-ack",
  "missing-ack",
  "invalid-event-payload",
  "invalid-channel-key",
  "unauthorized",
  "forbidden",
  "connection-denied",
  "join-denied",
  "command-failed",
  "timeout",
  "internal-error"
] as const);

/**
 * Допустимый код unified realtime error model.
 */
export type RealtimeErrorCode = (typeof REALTIME_ERROR_CODES)[number];

/**
 * Дополнительные сериализуемые детали realtime-ошибки.
 */
export type RealtimeErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Официальные коды ошибок, относящиеся именно к validation-слою.
 */
export const REALTIME_VALIDATION_ERROR_CODES = Object.freeze([
  "invalid-input",
  "invalid-ack",
  "invalid-event-payload",
  "invalid-channel-key"
] as const);

/**
 * Подмножество realtime error codes для validation-сценариев.
 */
export type RealtimeValidationErrorCode =
  (typeof REALTIME_VALIDATION_ERROR_CODES)[number];

/**
 * Источник validation-ошибки до нормализации.
 */
export type RealtimeValidationErrorSource = "zod" | "runtime";

/**
 * Нормализованная issue-запись внутри validation-ошибки.
 */
export interface RealtimeValidationIssue {
  /**
   * Путь до проблемного значения в исходном payload.
   */
  readonly path: readonly (string | number)[];

  /**
   * Человекочитаемое описание конкретной проблемы.
   */
  readonly message: string;

  /**
   * Машинный код конкретной проблемы от schema/runtime слоя.
   */
  readonly code: string;
}

/**
 * Детали validation-ошибки в unified realtime error shape.
 */
export type RealtimeValidationErrorDetails = RealtimeErrorDetails &
  Readonly<{
    /**
     * Источник первичной validation-ошибки.
     */
    readonly source: RealtimeValidationErrorSource;

    /**
     * Нормализованный список validation issues.
     */
    readonly issues: readonly RealtimeValidationIssue[];
  }>;

/**
 * JSON-совместимая форма realtime-ошибки для transport/logging сценариев.
 */
export interface RealtimeErrorPayload<
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> {
  /**
   * Стабильное имя ошибки библиотеки.
   */
  readonly name: "LiveRailRealtimeError";

  /**
   * Официальный код ошибки из общего списка.
   */
  readonly code: TCode;

  /**
   * Человекочитаемое описание причины ошибки.
   */
  readonly message: string;

  /**
   * Необязательные сериализуемые детали ошибки.
   */
  readonly details?: RealtimeErrorDetails;
}

/**
 * Параметры создания unified realtime error.
 */
export interface CreateRealtimeErrorOptions<
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> {
  /**
   * Официальный код ошибки.
   */
  readonly code: TCode;

  /**
   * Человекочитаемое описание ошибки.
   */
  readonly message: string;

  /**
   * Необязательные сериализуемые детали.
   */
  readonly details?: RealtimeErrorDetails;

  /**
   * Исходная причина ошибки из нижележащего слоя.
   */
  readonly cause?: unknown;
}

/**
 * Параметры нормализации validation-ошибки в unified realtime error shape.
 */
export interface NormalizeValidationErrorOptions<
  TCode extends RealtimeValidationErrorCode = RealtimeValidationErrorCode
> {
  /**
   * Официальный validation error code.
   */
  readonly code: TCode;

  /**
   * Необязательное сообщение верхнего уровня.
   */
  readonly message?: string;

  /**
   * Необязательные дополнительные details, которые нужно сохранить поверх issues.
   */
  readonly details?: RealtimeErrorDetails;
}

/**
 * Единая runtime-ошибка библиотеки с официальным кодом и стабильным shape.
 */
export class LiveRailRealtimeError<
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> extends Error {
  /**
   * Стабильное имя ошибки библиотеки.
   */
  override readonly name = "LiveRailRealtimeError" as const;

  /**
   * Официальный код ошибки.
   */
  readonly code: TCode;

  /**
   * Необязательные сериализуемые детали ошибки.
   */
  readonly details: RealtimeErrorDetails | undefined;

  /**
   * Исходная причина ошибки, если она была передана.
   */
  override readonly cause?: unknown;

  /**
   * Создает realtime-ошибку общего формата и защищает ее от мутаций.
   */
  constructor(options: CreateRealtimeErrorOptions<TCode>) {
    super(options.message, {
      cause: options.cause
    });

    assertRealtimeErrorCode(options.code);

    this.code = options.code;
    this.details =
      options.details === undefined
        ? undefined
        : (deepFreeze(cloneDeep(options.details)) as RealtimeErrorDetails);
    this.cause = options.cause;

    Object.setPrototypeOf(this, new.target.prototype);
    Object.freeze(this);
  }

  /**
   * Возвращает стабильную JSON-совместимую форму ошибки.
   */
  toJSON(): RealtimeErrorPayload<TCode> {
    const payload: RealtimeErrorPayload<TCode> = {
      name: this.name,
      code: this.code,
      message: this.message
    };

    if (this.details !== undefined) {
      return {
        ...payload,
        details: this.details
      };
    }

    return payload;
  }
}

/**
 * Нормализованная validation-ошибка в общем realtime формате.
 */
export type RealtimeValidationError<
  TCode extends RealtimeValidationErrorCode = RealtimeValidationErrorCode
> = LiveRailRealtimeError<TCode> & {
  readonly details: RealtimeValidationErrorDetails;
};

/**
 * Создает unified realtime error общего формата.
 */
export function createRealtimeError<TCode extends RealtimeErrorCode>(
  options: CreateRealtimeErrorOptions<TCode>
): LiveRailRealtimeError<TCode> {
  return new LiveRailRealtimeError(options);
}

/**
 * Проверяет, является ли значение официальной realtime-ошибкой библиотеки.
 */
export function isRealtimeError(
  value: unknown
): value is LiveRailRealtimeError<RealtimeErrorCode> {
  return value instanceof LiveRailRealtimeError;
}

/**
 * Проверяет, что значение является нормализованной validation-ошибкой и
 * безопасно открывает доступ к `source` и `issues`.
 */
export function isRealtimeValidationError(
  value: unknown
): value is RealtimeValidationError<RealtimeValidationErrorCode> {
  if (!isRealtimeError(value)) {
    return false;
  }

  if (
    !REALTIME_VALIDATION_ERROR_CODE_SET.has(
      value.code as RealtimeValidationErrorCode
    )
  ) {
    return false;
  }

  if (!isObjectLike(value.details)) {
    return false;
  }

  return (
    (value.details.source === "zod" || value.details.source === "runtime") &&
    Array.isArray(value.details.issues)
  );
}

/**
 * Нормализует schema/runtime ошибку в единый realtime error shape для validation-слоя.
 */
export function normalizeValidationError<
  TCode extends RealtimeValidationErrorCode
>(
  error: unknown,
  options: NormalizeValidationErrorOptions<TCode>
): RealtimeValidationError<TCode> {
  assertValidationErrorCode(options.code);

  if (isRealtimeError(error)) {
    return error as RealtimeValidationError<TCode>;
  }

  const source: RealtimeValidationErrorSource =
    error instanceof ZodError ? "zod" : "runtime";
  const issues =
    error instanceof ZodError
      ? error.issues.map((issue) => ({
          path: Object.freeze([...issue.path]),
          message: issue.message,
          code: issue.code
        }))
      : [
          {
            path: Object.freeze([]) as readonly (string | number)[],
            message:
              error instanceof Error
                ? error.message
                : "Unknown validation failure.",
            code:
              error instanceof Error ? error.name : "UnknownValidationError"
          }
        ];

  return createRealtimeError({
    code: options.code,
    message: options.message ?? VALIDATION_ERROR_MESSAGE_BY_CODE[options.code],
    details: {
      ...(options.details ?? {}),
      source,
      issues
    } as RealtimeValidationErrorDetails,
    cause: error
  }) as RealtimeValidationError<TCode>;
}

function assertRealtimeErrorCode(
  code: string
): asserts code is RealtimeErrorCode {
  if (!REALTIME_ERROR_CODE_SET.has(code as RealtimeErrorCode)) {
    throw new TypeError(`Unsupported realtime error code: "${code}".`);
  }
}

function assertValidationErrorCode(
  code: string
): asserts code is RealtimeValidationErrorCode {
  if (
    !REALTIME_VALIDATION_ERROR_CODE_SET.has(
      code as RealtimeValidationErrorCode
    )
  ) {
    throw new TypeError(`Unsupported validation error code: "${code}".`);
  }
}

const REALTIME_ERROR_CODE_SET = new Set<RealtimeErrorCode>(REALTIME_ERROR_CODES);
const REALTIME_VALIDATION_ERROR_CODE_SET = new Set<RealtimeValidationErrorCode>(
  REALTIME_VALIDATION_ERROR_CODES
);
const VALIDATION_ERROR_MESSAGE_BY_CODE: Record<
  RealtimeValidationErrorCode,
  string
> = {
  "invalid-input": "Command input validation failed.",
  "invalid-ack": "Command ack validation failed.",
  "invalid-event-payload": "Event payload validation failed.",
  "invalid-channel-key": "Channel key validation failed."
};
