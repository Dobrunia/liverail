import {
  createChannelInstance,
  createRealtimeError,
  isRealtimeError,
  parseCommandAck,
  parseCommandInput,
  parseEventPayload
} from "@liverail/contracts";
import type {
  ChannelContract,
  ChannelKey,
  CommandAck,
  CommandInput,
  CommandContract,
  ContractRegistry,
  EventContract,
  EventPayload,
  PolicyContract,
  ResolveSchemaInput
} from "@liverail/contracts";

type MaybePromise<T> = T | Promise<T>;

type CommandName<TRegistry extends ContractRegistry> =
  keyof TRegistry["commands"]["byName"] & string;
type EventName<TRegistry extends ContractRegistry> =
  keyof TRegistry["events"]["byName"] & string;
type ChannelName<TRegistry extends ContractRegistry> =
  keyof TRegistry["channels"]["byName"] & string;

/**
 * Параметры создания transport-agnostic server runtime.
 */
export interface CreateServerRuntimeOptions<
  TRuntimeContext = unknown,
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Единый registry-контрактов, вокруг которого строится runtime.
   */
  readonly registry: TRegistry;

  /**
   * Typed command handler-ы, через которые runtime исполняет команды.
   */
  readonly commandHandlers?: ServerCommandHandlers<TRegistry, TRuntimeContext>;

  /**
   * Необязательные authorizer-функции для command pipeline.
   */
  readonly commandAuthorizers?: ServerCommandAuthorizers<
    TRegistry,
    TRuntimeContext
  >;

  /**
   * Typed router-ы server events.
   */
  readonly eventRouters?: ServerEventRouters<TRegistry, TRuntimeContext>;

  /**
   * Typed deliverer-ы server events.
   */
  readonly eventDeliverers?: ServerEventDeliverers<TRegistry, TRuntimeContext>;

  /**
   * Typed authorizer-ы join-операций для channel membership runtime.
   */
  readonly channelJoinAuthorizers?: ServerChannelJoinAuthorizers<
    TRegistry,
    TRuntimeContext
  >;
}

/**
 * Базовый server runtime, который знает только про registry и typed lookup
 * contracts, не привязываясь к конкретному транспорту.
 */
export interface ServerRuntime<
  TRuntimeContext = unknown,
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Явный registry-контрактов, используемый всеми следующими pipeline-слоями.
   */
  readonly registry: TRegistry;

  /**
   * Разрешает command-контракт по имени.
   */
  resolveCommand<TName extends keyof TRegistry["commands"]["byName"] & string>(
    name: TName
  ): TRegistry["commands"]["byName"][TName];
  resolveCommand(name: string): CommandContract | undefined;

  /**
   * Разрешает event-контракт по имени.
   */
  resolveEvent<TName extends keyof TRegistry["events"]["byName"] & string>(
    name: TName
  ): TRegistry["events"]["byName"][TName];
  resolveEvent(name: string): EventContract | undefined;

  /**
   * Разрешает channel-контракт по имени.
   */
  resolveChannel<TName extends keyof TRegistry["channels"]["byName"] & string>(
    name: TName
  ): TRegistry["channels"]["byName"][TName];
  resolveChannel(name: string): ChannelContract | undefined;

  /**
   * Разрешает policy-контракт по имени.
   */
  resolvePolicy<TName extends keyof TRegistry["policies"]["byName"] & string>(
    name: TName
  ): TRegistry["policies"]["byName"][TName];
  resolvePolicy(name: string): PolicyContract<string, any> | undefined;

  /**
   * Исполняет команду через единый pipeline: validate -> authorize -> handle -> ack.
   */
  executeCommand<TName extends CommandName<TRegistry>>(
    name: TName,
    input: ResolveSchemaInput<TRegistry["commands"]["byName"][TName]["input"]>,
    options: ExecuteServerCommandOptions<TRuntimeContext>
  ): Promise<CommandAck<TRegistry["commands"]["byName"][TName]>>;

  /**
   * Исполняет server-to-client event pipeline: validate -> route -> deliver.
   */
  emitEvent<TName extends EventName<TRegistry>>(
    name: TName,
    payload: ResolveSchemaInput<TRegistry["events"]["byName"][TName]["payload"]>,
    options: ExecuteServerEventOptions<TRuntimeContext>
  ): Promise<
    readonly ServerEventDelivery<
      TRegistry["events"]["byName"][TName],
      TRuntimeContext
    >[]
  >;

  /**
   * Добавляет участника в typed channel instance.
   */
  joinChannel<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>,
    options: ExecuteServerJoinOptions<TRuntimeContext>
  ): Promise<
    ChannelMembership<TRegistry["channels"]["byName"][TName], TRuntimeContext>
  >;

  /**
   * Удаляет участника из typed channel instance.
   */
  leaveChannel<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>,
    options: ExecuteServerLeaveOptions
  ): Promise<boolean>;

  /**
   * Возвращает текущий состав конкретного channel instance.
   */
  listChannelMembers<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>
  ): readonly ChannelMembership<
    TRegistry["channels"]["byName"][TName],
    TRuntimeContext
  >[];
}

/**
 * Server-specific execution context для command pipeline.
 */
export interface ServerCommandExecution<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт исполняемой команды.
   */
  readonly contract: TCommand;

  /**
   * Имя команды как стабильный dispatch-идентификатор.
   */
  readonly name: TCommand["name"];

  /**
   * Нормализованный input после schema validation.
   */
  readonly input: CommandInput<TCommand>;

  /**
   * Server-side runtime context текущего вызова.
   */
  readonly context: TRuntimeContext;
}

/**
 * Typed handler команды внутри server runtime.
 */
export type ServerCommandHandler<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown
> = (
  execution: ServerCommandExecution<TCommand, TRuntimeContext>
) => MaybePromise<ResolveSchemaInput<TCommand["ack"]>>;

/**
 * Typed authorizer для command pipeline.
 */
export type ServerCommandAuthorizer<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown
> = (
  execution: ServerCommandExecution<TCommand, TRuntimeContext>
) => MaybePromise<boolean>;

/**
 * Набор handler-ов команд, зарегистрированных в runtime.
 */
export type ServerCommandHandlers<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in CommandName<TRegistry>]: ServerCommandHandler<
    TRegistry["commands"]["byName"][TName],
    TRuntimeContext
  >;
}>;

/**
 * Набор authorizer-ов команд, зарегистрированных в runtime.
 */
export type ServerCommandAuthorizers<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in CommandName<TRegistry>]: ServerCommandAuthorizer<
    TRegistry["commands"]["byName"][TName],
    TRuntimeContext
  >;
}>;

/**
 * Параметры выполнения конкретного command pipeline.
 */
export interface ExecuteServerCommandOptions<TRuntimeContext = unknown> {
  /**
   * Runtime-контекст текущего запроса, который передается в authorize и handler.
   */
  readonly context: TRuntimeContext;
}

/**
 * Нормализованная route-запись event emission pipeline.
 */
export interface ServerEventRoute {
  /**
   * Логический идентификатор цели доставки, не завязанный на transport API.
   */
  readonly target: string;

  /**
   * Дополнительные сериализуемые данные о маршруте.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Server-specific execution context для event emission pipeline.
 */
export interface ServerEventEmission<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт испускаемого события.
   */
  readonly contract: TEvent;

  /**
   * Имя события как стабильный dispatch-идентификатор.
   */
  readonly name: TEvent["name"];

  /**
   * Нормализованный payload после schema validation.
   */
  readonly payload: EventPayload<TEvent>;

  /**
   * Server-side runtime context текущего emit-вызова.
   */
  readonly context: TRuntimeContext;
}

/**
 * Финальная delivery-запись конкретного server event.
 */
export interface ServerEventDelivery<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> extends ServerEventEmission<TEvent, TRuntimeContext> {
  /**
   * Маршрут, по которому событие должно быть доставлено.
   */
  readonly route: ServerEventRoute;
}

/**
 * Typed router для event emission pipeline.
 */
export type ServerEventRouter<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> = (
  emission: ServerEventEmission<TEvent, TRuntimeContext>
) => MaybePromise<ServerEventRoute | readonly ServerEventRoute[]>;

/**
 * Typed deliverer для конкретного server event.
 */
export type ServerEventDeliverer<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> = (
  delivery: ServerEventDelivery<TEvent, TRuntimeContext>
) => MaybePromise<void>;

/**
 * Набор router-ов событий, зарегистрированных в runtime.
 */
export type ServerEventRouters<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in EventName<TRegistry>]: ServerEventRouter<
    TRegistry["events"]["byName"][TName],
    TRuntimeContext
  >;
}>;

/**
 * Набор deliverer-ов событий, зарегистрированных в runtime.
 */
export type ServerEventDeliverers<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in EventName<TRegistry>]: ServerEventDeliverer<
    TRegistry["events"]["byName"][TName],
    TRuntimeContext
  >;
}>;

/**
 * Параметры выполнения конкретного event emission pipeline.
 */
export interface ExecuteServerEventOptions<TRuntimeContext = unknown> {
  /**
   * Runtime-контекст текущего emit-вызова.
   */
  readonly context: TRuntimeContext;
}

/**
 * Server-specific execution context для channel join pipeline.
 */
export interface ServerChannelJoinExecution<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт канала, в который идет join.
   */
  readonly contract: TChannel;

  /**
   * Имя channel template.
   */
  readonly name: TChannel["name"];

  /**
   * Нормализованный channel key конкретного instance.
   */
  readonly key: ChannelKey<TChannel>;

  /**
   * Идентификатор участника в transport-agnostic форме.
   */
  readonly memberId: string;

  /**
   * Runtime-контекст join-операции.
   */
  readonly context: TRuntimeContext;
}

/**
 * Текущая membership-запись конкретного channel instance.
 */
export interface ChannelMembership<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown
> extends ServerChannelJoinExecution<TChannel, TRuntimeContext> {}

/**
 * Authorizer typed join-операции для channel membership runtime.
 */
export type ServerChannelJoinAuthorizer<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown
> = (
  execution: ServerChannelJoinExecution<TChannel, TRuntimeContext>
) => MaybePromise<boolean>;

/**
 * Набор join authorizer-ов каналов, зарегистрированных в runtime.
 */
export type ServerChannelJoinAuthorizers<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in ChannelName<TRegistry>]: ServerChannelJoinAuthorizer<
    TRegistry["channels"]["byName"][TName],
    TRuntimeContext
  >;
}>;

/**
 * Параметры join-операции в channel membership runtime.
 */
export interface ExecuteServerJoinOptions<TRuntimeContext = unknown> {
  /**
   * Идентификатор участника, который входит в channel instance.
   */
  readonly memberId: string;

  /**
   * Runtime-контекст join-операции.
   */
  readonly context: TRuntimeContext;
}

/**
 * Параметры leave-операции в channel membership runtime.
 */
export interface ExecuteServerLeaveOptions {
  /**
   * Идентификатор участника, которого нужно удалить из membership.
   */
  readonly memberId: string;
}

/**
 * Создает базовый server runtime вокруг explicit contract registry.
 */
export function createServerRuntime<
  TRuntimeContext = unknown,
  TRegistry extends ContractRegistry = ContractRegistry
>(
  options: CreateServerRuntimeOptions<TRuntimeContext, TRegistry>
): ServerRuntime<TRuntimeContext, TRegistry> {
  if (options?.registry === undefined) {
    throw new TypeError("Server runtime requires a contract registry.");
  }

  const { registry } = options;
  const commandHandlers = options.commandHandlers ?? {};
  const commandAuthorizers = options.commandAuthorizers ?? {};
  const eventRouters = options.eventRouters ?? {};
  const eventDeliverers = options.eventDeliverers ?? {};
  const channelJoinAuthorizers = options.channelJoinAuthorizers ?? {};
  const channelMemberships = new Map<
    string,
    Map<string, ChannelMembership<ChannelContract, TRuntimeContext>>
  >();

  return Object.freeze({
    registry,
    resolveCommand(name: string) {
      return registry.commands.byName[
        name as keyof typeof registry.commands.byName
      ] as CommandContract | undefined;
    },
    resolveEvent(name: string) {
      return registry.events.byName[
        name as keyof typeof registry.events.byName
      ] as EventContract | undefined;
    },
    resolveChannel(name: string) {
      return registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;
    },
    resolvePolicy(name: string) {
      return registry.policies.byName[
        name as keyof typeof registry.policies.byName
      ] as PolicyContract<string, any> | undefined;
    },
    async executeCommand(
      name: string,
      input: unknown,
      executionOptions: ExecuteServerCommandOptions<TRuntimeContext>
    ) {
      if (executionOptions === undefined) {
        throw new TypeError("Command execution requires runtime options.");
      }

      const contract = registry.commands.byName[
        name as keyof typeof registry.commands.byName
      ] as CommandContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown command contract: ${name}.`);
      }

      const handler = commandHandlers[
        name as keyof typeof commandHandlers
      ] as ServerCommandHandler<CommandContract, TRuntimeContext> | undefined;

      if (handler === undefined) {
        throw new TypeError(`No command handler registered for command: ${name}.`);
      }

      const parsedInput = parseCommandInput(contract, input);
      const execution = {
        contract,
        name: contract.name,
        input: parsedInput,
        context: executionOptions.context
      } as ServerCommandExecution<CommandContract, TRuntimeContext>;
      const authorizer = commandAuthorizers[
        name as keyof typeof commandAuthorizers
      ] as
        | ServerCommandAuthorizer<CommandContract, TRuntimeContext>
        | undefined;

      if (authorizer !== undefined) {
        try {
          const allowed = await authorizer(execution);

          if (!allowed) {
            throw createRealtimeError({
              code: "forbidden",
              message: `Command execution is forbidden: "${name}".`
            });
          }
        } catch (error) {
          throw normalizeCommandPipelineError(error, name, "authorize");
        }
      }

      try {
        const rawAck = await handler(execution);

        return parseCommandAck(contract, rawAck);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeCommandPipelineError(error, name, "handle");
      }
    },
    async emitEvent(
      name: string,
      payload: unknown,
      executionOptions: ExecuteServerEventOptions<TRuntimeContext>
    ) {
      if (executionOptions === undefined) {
        throw new TypeError("Event emission requires runtime options.");
      }

      const contract = registry.events.byName[
        name as keyof typeof registry.events.byName
      ] as EventContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown event contract: ${name}.`);
      }

      const router = eventRouters[
        name as keyof typeof eventRouters
      ] as ServerEventRouter<EventContract, TRuntimeContext> | undefined;

      if (router === undefined) {
        throw new TypeError(`No event router registered for event: ${name}.`);
      }

      const deliverer = eventDeliverers[
        name as keyof typeof eventDeliverers
      ] as ServerEventDeliverer<EventContract, TRuntimeContext> | undefined;

      if (deliverer === undefined) {
        throw new TypeError(`No event deliverer registered for event: ${name}.`);
      }

      const parsedPayload = parseEventPayload(contract, payload);
      const emission = {
        contract,
        name: contract.name,
        payload: parsedPayload,
        context: executionOptions.context
      } as ServerEventEmission<EventContract, TRuntimeContext>;

      let routes:
        | ServerEventRoute
        | readonly ServerEventRoute[];

      try {
        routes = await router(emission);
      } catch (error) {
        throw normalizeEventEmissionError(error, name, "route");
      }

      const normalizedRoutes = Array.isArray(routes) ? routes : [routes];
      const deliveries: ServerEventDelivery<EventContract, TRuntimeContext>[] = [];

      for (const route of normalizedRoutes) {
        const delivery = {
          ...emission,
          route
        } as ServerEventDelivery<EventContract, TRuntimeContext>;

        try {
          await deliverer(delivery);
        } catch (error) {
          throw normalizeEventEmissionError(error, name, "deliver");
        }

        deliveries.push(delivery);
      }

      return Object.freeze([...deliveries]) as readonly ServerEventDelivery<
        EventContract,
        TRuntimeContext
      >[];
    },
    async joinChannel(
      name: string,
      key: unknown,
      executionOptions: ExecuteServerJoinOptions<TRuntimeContext>
    ) {
      if (executionOptions === undefined) {
        throw new TypeError("Channel join requires runtime options.");
      }

      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown channel contract: ${name}.`);
      }

      const instance = createChannelInstance(contract, key);
      const joinExecution = {
        contract,
        name: contract.name,
        key: instance.key,
        memberId: executionOptions.memberId,
        context: executionOptions.context
      } as ServerChannelJoinExecution<ChannelContract, TRuntimeContext>;
      const authorizer = channelJoinAuthorizers[
        name as keyof typeof channelJoinAuthorizers
      ] as
        | ServerChannelJoinAuthorizer<ChannelContract, TRuntimeContext>
        | undefined;

      if (authorizer !== undefined) {
        try {
          const allowed = await authorizer(joinExecution);

          if (!allowed) {
            throw createRealtimeError({
              code: "join-denied",
              message: `Channel join is denied: "${name}".`
            });
          }
        } catch (error) {
          throw normalizeChannelJoinError(error, name, "authorize");
        }
      }

      const membership = Object.freeze({
        ...joinExecution
      }) as ChannelMembership<ChannelContract, TRuntimeContext>;
      const membershipBucketKey = getChannelMembershipBucketKey(
        name,
        instance.key
      );
      let membershipBucket = channelMemberships.get(membershipBucketKey);

      if (membershipBucket === undefined) {
        membershipBucket = new Map();
        channelMemberships.set(membershipBucketKey, membershipBucket);
      }

      membershipBucket.set(executionOptions.memberId, membership);

      return membership;
    },
    async leaveChannel(
      name: string,
      key: unknown,
      executionOptions: ExecuteServerLeaveOptions
    ) {
      if (executionOptions === undefined) {
        throw new TypeError("Channel leave requires runtime options.");
      }

      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown channel contract: ${name}.`);
      }

      const instance = createChannelInstance(contract, key);
      const membershipBucketKey = getChannelMembershipBucketKey(
        name,
        instance.key
      );
      const membershipBucket = channelMemberships.get(membershipBucketKey);

      if (membershipBucket === undefined) {
        return false;
      }

      const deleted = membershipBucket.delete(executionOptions.memberId);

      if (membershipBucket.size === 0) {
        channelMemberships.delete(membershipBucketKey);
      }

      return deleted;
    },
    listChannelMembers(name: string, key: unknown) {
      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown channel contract: ${name}.`);
      }

      const instance = createChannelInstance(contract, key);
      const membershipBucket = channelMemberships.get(
        getChannelMembershipBucketKey(name, instance.key)
      );

      if (membershipBucket === undefined) {
        return Object.freeze([]) as readonly ChannelMembership<
          ChannelContract,
          TRuntimeContext
        >[];
      }

      return Object.freeze([...membershipBucket.values()]) as readonly ChannelMembership<
        ChannelContract,
        TRuntimeContext
      >[];
    }
  }) as ServerRuntime<TRuntimeContext, TRegistry>;
}

function normalizeCommandPipelineError(
  error: unknown,
  commandName: string,
  stage: "authorize" | "handle"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "command-failed",
    message: `Command execution failed at stage "${stage}": "${commandName}".`,
    details: {
      commandName,
      stage
    },
    cause: error
  });
}

function normalizeEventEmissionError(
  error: unknown,
  eventName: string,
  stage: "route" | "deliver"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Event emission failed at stage "${stage}": "${eventName}".`,
    details: {
      eventName,
      stage
    },
    cause: error
  });
}

function normalizeChannelJoinError(
  error: unknown,
  channelName: string,
  stage: "authorize"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Channel join failed at stage "${stage}": "${channelName}".`,
    details: {
      channelName,
      stage
    },
    cause: error
  });
}

function getChannelMembershipBucketKey(
  channelName: string,
  key: ChannelKey<ChannelContract>
): string {
  return `${channelName}:${JSON.stringify(key)}`;
}
