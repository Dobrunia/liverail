import type { ContractMetadata } from "./primitives.ts";

/**
 * Базовый тип runtime-контекста, который будет разделяться сервером, клиентом
 * и policy/handler-слоями.
 */
export interface RuntimeContext<
  TConnection = unknown,
  TSession = unknown,
  TUser = unknown,
  TMetadata = ContractMetadata
> {
  /**
   * Транспортное соединение или его абстракция.
   */
  readonly connection: TConnection;

  /**
   * Сессионные данные текущего realtime-сеанса.
   */
  readonly session: TSession;

  /**
   * Данные аутентифицированного пользователя или иной actor context.
   */
  readonly user: TUser;

  /**
   * Дополнительные transport/runtime-метаданные.
   */
  readonly metadata: TMetadata;
}
