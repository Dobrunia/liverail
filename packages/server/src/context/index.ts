import type { ContractMetadata, RuntimeContext } from "@liverail/contracts";

/**
 * Transport-agnostic описание активного realtime-соединения.
 */
export interface ServerConnection<TTransport extends string = string> {
  /**
   * Стабильный идентификатор transport-соединения.
   */
  readonly id: string;

  /**
   * Логическое имя transport-а, а не его сырой runtime object.
   */
  readonly transport: TTransport;
}

/**
 * Официальный unified runtime context серверной части.
 */
export type ServerRuntimeContext<
  TSession = unknown,
  TUser = unknown,
  TMetadata = ContractMetadata,
  TTransport extends string = string
> = RuntimeContext<ServerConnection<TTransport>, TSession, TUser, TMetadata>;

/**
 * Transport-level данные, которых достаточно для построения unified context.
 */
export interface ServerRuntimeContextInit<
  TSession = unknown,
  TUser = unknown,
  TMetadata = ContractMetadata
> {
  /**
   * Нормализованные session-данные текущего realtime-сеанса.
   */
  readonly session: TSession;

  /**
   * Нормализованный actor/user context.
   */
  readonly user: TUser;

  /**
   * Дополнительные transport/runtime-метаданные.
   */
  readonly metadata: TMetadata;
}

/**
 * Параметры сборки unified server runtime context.
 */
export interface CreateServerRuntimeContextOptions<
  TSession = unknown,
  TUser = unknown,
  TMetadata = ContractMetadata,
  TTransport extends string = string
> extends ServerRuntimeContextInit<TSession, TUser, TMetadata> {
  /**
   * Идентификатор текущего transport-соединения.
   */
  readonly connectionId: string;

  /**
   * Логическое имя transport-а.
   */
  readonly transport: TTransport;
}

/**
 * Создает единый transport-agnostic context для connect/policy/handler слоев.
 */
export function createServerRuntimeContext<
  TSession,
  TUser,
  TMetadata,
  TTransport extends string
>(
  options: CreateServerRuntimeContextOptions<
    TSession,
    TUser,
    TMetadata,
    TTransport
  >
): ServerRuntimeContext<TSession, TUser, TMetadata, TTransport> {
  assertNonEmptyString(options.connectionId, "Server connection id");
  assertNonEmptyString(options.transport, "Server transport name");

  return Object.freeze({
    connection: Object.freeze({
      id: options.connectionId,
      transport: options.transport
    }),
    session: options.session,
    user: options.user,
    metadata: options.metadata
  });
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}
