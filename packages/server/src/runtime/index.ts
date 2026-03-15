import {
  createChannelInstance,
  createRealtimeError,
  inspectContractRegistry,
  isRealtimeError,
  parseCommandAck,
  parseCommandInput,
  parseEventPayload,
  stringifyChannelInstance
} from "@liverail/contracts";
import type {
  ChannelContract,
  ChannelKey,
  CommandAck,
  CommandInput,
  CommandContract,
  CommandPolicyContract,
  ContractRegistryIntrospection,
  ConnectPolicyContract,
  ContractRegistry,
  EventContract,
  EventPayload,
  JoinPolicyContract,
  PolicyDenyDecision,
  PolicyContract,
  PolicyResolution,
  RealtimeErrorCode,
  RealtimeErrorPayload,
  ReceivePolicyContract,
  ResolveSchemaInput
} from "@liverail/contracts";

type MaybePromise<T> = T | Promise<T>;

/**
 * Внутренний bridge-ключ для transport adapter-ов, которым нужно сообщать
 * runtime о connect/disconnect стадиях без расширения официального public API.
 */
export const SERVER_RUNTIME_LIFECYCLE_BRIDGE = Symbol(
  "liverail.server.runtime.lifecycle-bridge"
);

type CommandName<TRegistry extends ContractRegistry> =
  keyof TRegistry["commands"]["byName"] & string;
type EventName<TRegistry extends ContractRegistry> =
  keyof TRegistry["events"]["byName"] & string;
type ChannelName<TRegistry extends ContractRegistry> =
  keyof TRegistry["channels"]["byName"] & string;

type IsAny<TValue> = 0 extends 1 & TValue ? true : false;

type IsUnknown<TValue> = IsAny<TValue> extends true
  ? false
  : unknown extends TValue
    ? ([TValue] extends [unknown] ? true : false)
    : false;

type KnownServerRuntimeContext<TValue> = IsAny<TValue> extends true
  ? never
  : IsUnknown<TValue> extends true
    ? never
    : TValue;

type RequiresServerRuntimeContext<TValue> =
  [KnownServerRuntimeContext<TValue>] extends [never]
    ? false
    : [TValue] extends [void | undefined]
      ? false
      : true;

type UnionToIntersection<TValue> =
  (TValue extends unknown ? (value: TValue) => void : never) extends (
    value: infer TResult
  ) => void
    ? TResult
    : never;

type Simplify<TValue> = {
  [TKey in keyof TValue]: TValue[TKey];
} & {};

/**
 * Внутренний extractor контекста из публичных server runtime policy/handler API.
 * Нужен только для authoring-time inference и не влияет на runtime-поведение.
 */
type ExtractServerRuntimeContext<TValue> =
  TValue extends undefined
    ? never
    : TValue extends readonly (infer TItem)[]
      ? ExtractServerRuntimeContext<TItem>
      : TValue extends ConnectPolicyContract<string, infer TContext, any>
        ? KnownServerRuntimeContext<TContext>
        : TValue extends CommandPolicyContract<string, any, infer TContext>
          ? KnownServerRuntimeContext<TContext>
          : TValue extends JoinPolicyContract<string, any, infer TContext>
            ? KnownServerRuntimeContext<TContext>
            : TValue extends ReceivePolicyContract<string, any, infer TContext, any>
              ? KnownServerRuntimeContext<TContext>
              : TValue extends (execution: infer TExecution) => unknown
                ? TExecution extends { readonly context: infer TContext }
                  ? KnownServerRuntimeContext<TContext>
                  : never
                : TValue extends Record<string, infer TMember>
                  ? ExtractServerRuntimeContext<TMember>
                  : never;

type NormalizeServerRuntimeContext<TContext> = [TContext] extends [never]
  ? unknown
  : Simplify<UnionToIntersection<TContext>>;

type InferServerRuntimeContext<
  TConnectionPolicies,
  TCommandPolicies,
  TCommandHandlers,
  TCommandAuthorizers,
  TEventRouters,
  TEventReceivePolicies,
  TEventDeliverers,
  TChannelJoinPolicies,
  TChannelJoinAuthorizers,
  TLifecycleHooks
> = NormalizeServerRuntimeContext<
  | ExtractServerRuntimeContext<TConnectionPolicies>
  | ExtractServerRuntimeContext<TCommandPolicies>
  | ExtractServerRuntimeContext<TCommandHandlers>
  | ExtractServerRuntimeContext<TCommandAuthorizers>
  | ExtractServerRuntimeContext<TEventRouters>
  | ExtractServerRuntimeContext<TEventReceivePolicies>
  | ExtractServerRuntimeContext<TEventDeliverers>
  | ExtractServerRuntimeContext<TChannelJoinPolicies>
  | ExtractServerRuntimeContext<TChannelJoinAuthorizers>
  | ExtractServerRuntimeContext<TLifecycleHooks>
>;

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
   * Typed policy-набор для connection access layer.
   */
  readonly connectionPolicies?: ServerConnectionPolicies<TRuntimeContext>;

  /**
   * Typed policy-набор для command access layer.
   */
  readonly commandPolicies?: ServerCommandPolicies<TRegistry, TRuntimeContext>;

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
   * Typed receive policy-набор для event delivery layer.
   */
  readonly eventReceivePolicies?: ServerEventReceivePolicies<
    TRegistry,
    TRuntimeContext
  >;

  /**
   * Typed deliverer-ы server events.
   */
  readonly eventDeliverers?: ServerEventDeliverers<TRegistry, TRuntimeContext>;

  /**
   * Typed authorizer-ы join-операций для channel membership runtime.
   */
  readonly channelJoinPolicies?: ServerChannelJoinPolicies<
    TRegistry,
    TRuntimeContext
  >;

  /**
   * Typed authorizer-ы join-операций для channel membership runtime.
   */
  readonly channelJoinAuthorizers?: ServerChannelJoinAuthorizers<
    TRegistry,
    TRuntimeContext
  >;

  /**
   * Базовые lifecycle hooks server runtime для connect/disconnect/join/leave.
   */
  readonly lifecycleHooks?: ServerLifecycleHooks<TRegistry, TRuntimeContext>;
}

/**
 * Параметры strongly typed server runtime helper с выводом context из публичных
 * policy/handler сигнатур без обязательного явного generic на runtime factory.
 */
export type DefineServerRuntimeOptions<
  TRegistry extends ContractRegistry,
  TConnectionPolicies extends
    | ServerConnectionPolicies<any>
    | undefined = undefined,
  TCommandPolicies extends
    | ServerCommandPolicies<TRegistry, any>
    | undefined = undefined,
  TCommandHandlers extends
    | ServerCommandHandlers<TRegistry, any>
    | undefined = undefined,
  TCommandAuthorizers extends
    | ServerCommandAuthorizers<TRegistry, any>
    | undefined = undefined,
  TEventRouters extends
    | ServerEventRouters<TRegistry, any>
    | undefined = undefined,
  TEventReceivePolicies extends
    | ServerEventReceivePolicies<TRegistry, any>
    | undefined = undefined,
  TEventDeliverers extends
    | ServerEventDeliverers<TRegistry, any>
    | undefined = undefined,
  TChannelJoinPolicies extends
    | ServerChannelJoinPolicies<TRegistry, any>
    | undefined = undefined,
  TChannelJoinAuthorizers extends
    | ServerChannelJoinAuthorizers<TRegistry, any>
    | undefined = undefined,
  TLifecycleHooks extends
    | ServerLifecycleHooks<TRegistry, any>
    | undefined = undefined,
  TRuntimeContext = InferServerRuntimeContext<
    TConnectionPolicies,
    TCommandPolicies,
    TCommandHandlers,
    TCommandAuthorizers,
    TEventRouters,
    TEventReceivePolicies,
    TEventDeliverers,
    TChannelJoinPolicies,
    TChannelJoinAuthorizers,
    TLifecycleHooks
  >
> = CreateServerRuntimeOptions<TRuntimeContext, TRegistry> & {
  readonly registry: TRegistry;
  readonly connectionPolicies?: TConnectionPolicies;
  readonly commandPolicies?: TCommandPolicies;
  readonly commandHandlers?: TCommandHandlers;
  readonly commandAuthorizers?: TCommandAuthorizers;
  readonly eventRouters?: TEventRouters;
  readonly eventReceivePolicies?: TEventReceivePolicies;
  readonly eventDeliverers?: TEventDeliverers;
  readonly channelJoinPolicies?: TChannelJoinPolicies;
  readonly channelJoinAuthorizers?: TChannelJoinAuthorizers;
  readonly lifecycleHooks?: TLifecycleHooks;
};

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
   * Возвращает read-only introspection snapshot зарегистрированных контрактов.
   */
  inspectContracts(): ContractRegistryIntrospection<
    TRegistry["commands"]["list"],
    TRegistry["events"]["list"],
    TRegistry["channels"]["list"],
    TRegistry["policies"]["list"]
  >;

  /**
   * Возвращает read-only debug snapshot текущего server runtime состояния.
   */
  inspectRuntime(): ServerRuntimeDebugSnapshot<TRegistry>;

  /**
   * Централизованно авторизует новое подключение через connect policy layer.
   */
  authorizeConnection(
    ...args: ServerConnectionArguments<TRuntimeContext>
  ): Promise<void>;

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
    ...args: ServerCommandArguments<TRuntimeContext>
  ): Promise<CommandAck<TRegistry["commands"]["byName"][TName]>>;

  /**
   * Исполняет server-to-client event pipeline: validate -> route -> deliver.
   */
  emitEvent<TName extends EventName<TRegistry>>(
    name: TName,
    payload: ResolveSchemaInput<TRegistry["events"]["byName"][TName]["payload"]>,
    ...args: ServerEventArguments<TRuntimeContext>
  ): Promise<
    readonly ServerEventDelivery<
      TRegistry["events"]["byName"][TName],
      TRuntimeContext
    >[]
  >;

  /**
   * Исполняет event pipeline и возвращает подробный report по delivered/denied route.
   */
  emitEventReport<TName extends EventName<TRegistry>>(
    name: TName,
    payload: ResolveSchemaInput<TRegistry["events"]["byName"][TName]["payload"]>,
    ...args: ServerEventArguments<TRuntimeContext>
  ): Promise<{
    readonly delivered: readonly ServerEventDelivery<
      TRegistry["events"]["byName"][TName],
      TRuntimeContext
    >[];
    readonly denied: readonly (ServerEventDelivery<
      TRegistry["events"]["byName"][TName],
      TRuntimeContext
    > & {
      readonly error: RealtimeErrorPayload;
    })[];
  }>;

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
 * Стабильное operational-состояние server runtime.
 */
export type ServerRuntimeState = "ready";

/**
 * Read-only debug entry активного channel instance.
 */
export interface ServerRuntimeActiveChannelDebug<
  TChannel extends ChannelContract = ChannelContract
> {
  /**
   * Контракт активного канала.
   */
  readonly contract: TChannel;

  /**
   * Имя channel template.
   */
  readonly name: TChannel["name"];

  /**
   * Нормализованный ключ конкретного channel instance.
   */
  readonly key: ChannelKey<TChannel>;

  /**
   * Текущее число участников channel instance.
   */
  readonly memberCount: number;

  /**
   * Идентификаторы текущих участников в детерминированном порядке.
   */
  readonly memberIds: readonly string[];
}

/**
 * Read-only debug snapshot server runtime.
 */
export interface ServerRuntimeDebugSnapshot<
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Текущее operational-состояние runtime.
   */
  readonly state: ServerRuntimeState;

  /**
   * Introspection зарегистрированных контрактов.
   */
  readonly contracts: ContractRegistryIntrospection<
    TRegistry["commands"]["list"],
    TRegistry["events"]["list"],
    TRegistry["channels"]["list"],
    TRegistry["policies"]["list"]
  >;

  /**
   * Имена подключенных connect policies.
   */
  readonly connectionPolicyNames: readonly string[];

  /**
   * Имена зарегистрированных command handlers.
   */
  readonly commandHandlerNames: readonly CommandName<TRegistry>[];

  /**
   * Имена зарегистрированных event routers.
   */
  readonly eventRouterNames: readonly EventName<TRegistry>[];

  /**
   * Имена зарегистрированных event deliverers.
   */
  readonly eventDelivererNames: readonly EventName<TRegistry>[];

  /**
   * Read-only список активных channel instances.
   */
  readonly activeChannels: readonly ServerRuntimeActiveChannelDebug<
    TRegistry["channels"]["list"][number]
  >[];
}

/**
 * Нормализованная lifecycle-модель конкретного server connection.
 */
export interface ServerConnectionLifecycle<TRuntimeContext = unknown> {
  /**
   * Стабильный transport-agnostic идентификатор подключения.
   */
  readonly connectionId: string;

  /**
   * Runtime-контекст конкретного подключения.
   */
  readonly context: TRuntimeContext;
}

/**
 * Hook обработки server connection lifecycle.
 */
export type ServerConnectionLifecycleHook<TRuntimeContext = unknown> = (
  connection: ServerConnectionLifecycle<TRuntimeContext>
) => MaybePromise<void>;

/**
 * Набор command policy-контрактов, зарегистрированных в runtime по command name.
 */
export type ServerCommandPolicies<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in CommandName<TRegistry>]: readonly CommandPolicyContract<
    string,
    TRegistry["commands"]["byName"][TName],
    TRuntimeContext
  >[];
}>;

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
 * Набор connect policy, подключенных к runtime.
 */
export type ServerConnectionPolicies<TRuntimeContext = unknown> =
  readonly ConnectPolicyContract<string, TRuntimeContext, any>[];

type ServerRuntimeContextOption<TRuntimeContext> =
  RequiresServerRuntimeContext<TRuntimeContext> extends true
    ? {
        /**
         * Runtime-контекст текущей операции.
         */
        readonly context: TRuntimeContext;
      }
    : {
        /**
         * Runtime-контекст текущей операции.
         * В no-context runtime может быть опущен полностью.
         */
        readonly context?: TRuntimeContext;
      };

type ServerConnectionArguments<TRuntimeContext> =
  RequiresServerRuntimeContext<TRuntimeContext> extends true
    ? [options: ExecuteServerConnectionOptions<TRuntimeContext>]
    : [options?: ExecuteServerConnectionOptions<TRuntimeContext>];

type ServerCommandArguments<TRuntimeContext> =
  RequiresServerRuntimeContext<TRuntimeContext> extends true
    ? [options: ExecuteServerCommandOptions<TRuntimeContext>]
    : [options?: ExecuteServerCommandOptions<TRuntimeContext>];

type ServerEventArguments<TRuntimeContext> =
  RequiresServerRuntimeContext<TRuntimeContext> extends true
    ? [options: ExecuteServerEventOptions<TRuntimeContext>]
    : [options?: ExecuteServerEventOptions<TRuntimeContext>];

/**
 * Параметры connection authorization в runtime.
 */
export type ExecuteServerConnectionOptions<TRuntimeContext = unknown> =
  ServerRuntimeContextOption<TRuntimeContext>;

/**
 * Параметры выполнения конкретного command pipeline.
 */
export type ExecuteServerCommandOptions<TRuntimeContext = unknown> =
  ServerRuntimeContextOption<TRuntimeContext>;

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
 * Конкретный получатель delivery после fan-out channel audience до участника.
 */
export interface ServerEventRecipient<TRuntimeContext = unknown> {
  /**
   * Идентификатор участника, которому адресована финальная доставка.
   */
  readonly memberId: string;

  /**
   * Runtime-контекст конкретного участника.
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

  /**
   * Конкретный получатель, если route был сузлен до отдельного участника.
   */
  readonly recipient?: ServerEventRecipient<TRuntimeContext>;
}

/**
 * Наблюдаемая запись route, которую receive policy явно запретила.
 */
interface ServerDeniedEventDelivery<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> extends ServerEventDelivery<TEvent, TRuntimeContext> {
  /**
   * Нормализованная realtime-ошибка конкретного deny-решения.
   */
  readonly error: RealtimeErrorPayload;
}

/**
 * Подробный итог event emission с разделением доставленных и запрещенных route.
 */
interface ServerEventEmissionReport<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown
> {
  /**
   * Route, которые реально дошли до deliverer-а.
   */
  readonly delivered: readonly ServerEventDelivery<TEvent, TRuntimeContext>[];

  /**
   * Route, которые были остановлены receive policy layer.
   */
  readonly denied: readonly ServerDeniedEventDelivery<TEvent, TRuntimeContext>[];
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
 * Набор receive policy-контрактов, зарегистрированных в runtime по event name.
 */
export type ServerEventReceivePolicies<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in EventName<TRegistry>]: readonly ReceivePolicyContract<
    string,
    TRegistry["events"]["byName"][TName],
    TRuntimeContext,
    ServerEventRoute,
    any,
    ServerEventRecipient<TRuntimeContext>
  >[];
}>;

/**
 * Параметры выполнения конкретного event emission pipeline.
 */
export type ExecuteServerEventOptions<TRuntimeContext = unknown> =
  ServerRuntimeContextOption<TRuntimeContext>;

/**
 * Набор базовых lifecycle hooks server runtime.
 */
export interface ServerLifecycleHooks<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> {
  /**
   * Вызывается после успешной transport-авторизации и открытия соединения.
   */
  readonly onConnect?: ServerConnectionLifecycleHook<TRuntimeContext>;

  /**
   * Вызывается во время transport disconnect cleanup.
   */
  readonly onDisconnect?: ServerConnectionLifecycleHook<TRuntimeContext>;

  /**
   * Вызывается после успешного добавления membership в channel instance.
   */
  readonly onJoin?: ServerJoinLifecycleHook<TRegistry, TRuntimeContext>;

  /**
   * Вызывается после успешного удаления membership из channel instance.
   */
  readonly onLeave?: ServerLeaveLifecycleHook<TRegistry, TRuntimeContext>;
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
 * Server-specific execution context для channel leave lifecycle.
 */
export interface ServerChannelLeaveExecution<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт канала, из которого идет leave.
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
   * Runtime-контекст, с которым membership был привязан к каналу.
   */
  readonly context: TRuntimeContext;
}

/**
 * Hook обработки lifecycle join конкретного channel instance.
 */
export type ServerJoinLifecycleHook<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = (
  membership: ServerJoinLifecycleExecution<TRegistry, TRuntimeContext>
) => MaybePromise<void>;

/**
 * Hook обработки lifecycle leave конкретного channel instance.
 */
export type ServerLeaveLifecycleHook<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = (
  execution: ServerLeaveLifecycleExecution<TRegistry, TRuntimeContext>
) => MaybePromise<void>;

/**
 * Union-представление membership payload для lifecycle join hook.
 */
type ServerJoinLifecycleExecution<
  TRegistry extends ContractRegistry,
  TRuntimeContext
> = TRegistry["channels"]["list"][number] extends infer TChannel extends
  ChannelContract
  ? ChannelMembership<TChannel, TRuntimeContext>
  : never;

/**
 * Union-представление leave payload для lifecycle leave hook.
 */
type ServerLeaveLifecycleExecution<
  TRegistry extends ContractRegistry,
  TRuntimeContext
> = TRegistry["channels"]["list"][number] extends infer TChannel extends
  ChannelContract
  ? ServerChannelLeaveExecution<TChannel, TRuntimeContext>
  : never;

/**
 * Набор join policy-контрактов, зарегистрированных в runtime по channel name.
 */
export type ServerChannelJoinPolicies<
  TRegistry extends ContractRegistry = ContractRegistry,
  TRuntimeContext = unknown
> = Partial<{
  readonly [TName in ChannelName<TRegistry>]: readonly JoinPolicyContract<
    string,
    TRegistry["channels"]["byName"][TName],
    TRuntimeContext
  >[];
}>;

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
export type ExecuteServerJoinOptions<TRuntimeContext = unknown> = {
  /**
   * Идентификатор участника, который входит в channel instance.
   */
  readonly memberId: string;
} & ServerRuntimeContextOption<TRuntimeContext>;

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
  if (options === undefined || options.registry === undefined) {
    throw new TypeError("Server runtime requires a contract registry.");
  }

  const { registry } = options;
  const connectionPolicies = options.connectionPolicies ?? [];
  const commandPolicies = options.commandPolicies ?? {};
  const commandHandlers = options.commandHandlers ?? {};
  const commandAuthorizers = options.commandAuthorizers ?? {};
  const eventRouters = options.eventRouters ?? {};
  const eventReceivePolicies = options.eventReceivePolicies ?? {};
  const eventDeliverers = options.eventDeliverers ?? {};
  const channelJoinPolicies = options.channelJoinPolicies ?? {};
  const channelJoinAuthorizers = options.channelJoinAuthorizers ?? {};
  const lifecycleHooks = options.lifecycleHooks ?? {};
  const contractIntrospection = inspectContractRegistry(registry);
  const connectionPolicyNames = Object.freeze(
    connectionPolicies.map((policy) => policy.name)
  );
  const commandHandlerNames = Object.freeze(
    Object.keys(commandHandlers)
  ) as readonly CommandName<TRegistry>[];
  const eventRouterNames = Object.freeze(
    Object.keys(eventRouters)
  ) as readonly EventName<TRegistry>[];
  const eventDelivererNames = Object.freeze(
    Object.keys(eventDeliverers)
  ) as readonly EventName<TRegistry>[];
  const activeChannelInstances = new Map<
    string,
    {
      readonly contract: ChannelContract;
      readonly name: string;
      readonly key: ChannelKey<ChannelContract>;
    }
  >();
  const channelMemberships = new Map<
    string,
    Map<string, ChannelMembership<ChannelContract, TRuntimeContext>>
  >();

  async function emitServerEventReport(
    name: string,
    payload: unknown,
    executionOptions?: ExecuteServerEventOptions<TRuntimeContext>
  ) {
    const normalizedOptions =
      executionOptions ??
      ({} as ExecuteServerEventOptions<TRuntimeContext>);

    const contract = registry.events.byName[
      name as keyof typeof registry.events.byName
    ] as EventContract | undefined;

    if (contract === undefined) {
      throw createUnknownServerContractError(
        "event",
        name,
        Object.keys(registry.events.byName)
      );
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
    const receivePolicies = eventReceivePolicies[
      name as keyof typeof eventReceivePolicies
    ] as
      | readonly ReceivePolicyContract<
          string,
          EventContract,
          TRuntimeContext,
          ServerEventRoute,
          any,
          ServerEventRecipient<TRuntimeContext>
        >[]
      | undefined;

    if (deliverer === undefined) {
      throw new TypeError(`No event deliverer registered for event: ${name}.`);
    }

    const parsedPayload = parseEventPayload(contract, payload);
    const emission = {
      contract,
      name: contract.name,
      payload: parsedPayload,
      context: normalizedOptions.context as TRuntimeContext
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
    const resolvedDeliveries = createServerEventDeliveries(
      emission,
      normalizedRoutes
    );
    const delivered: ServerEventDelivery<EventContract, TRuntimeContext>[] = [];
    const denied: ServerDeniedEventDelivery<EventContract, TRuntimeContext>[] = [];

    for (const delivery of resolvedDeliveries) {
      if (receivePolicies !== undefined) {
        let deniedError: RealtimeErrorPayload | undefined;

        for (const policy of receivePolicies) {
          try {
            const result = await policy.evaluate(delivery);
            const rejectionError = createPolicyRejectionError(
              result,
              "forbidden",
              `Event delivery is denied by policy: "${policy.name}".`
            );

            if (rejectionError !== undefined) {
              deniedError = rejectionError.toJSON();
              break;
            }
          } catch (error) {
            throw normalizePolicyEvaluationError(error, policy.name, "receive");
          }
        }

        if (deniedError !== undefined) {
          denied.push(
            Object.freeze({
              ...delivery,
              error: deniedError
            }) as ServerDeniedEventDelivery<EventContract, TRuntimeContext>
          );
          continue;
        }
      }

      try {
        await deliverer(delivery);
      } catch (error) {
        throw normalizeEventEmissionError(error, name, "deliver");
      }

      delivered.push(delivery);
    }

    return Object.freeze({
      delivered: Object.freeze([...delivered]) as readonly ServerEventDelivery<
        EventContract,
        TRuntimeContext
      >[],
      denied: Object.freeze([...denied]) as readonly ServerDeniedEventDelivery<
        EventContract,
        TRuntimeContext
      >[]
    }) as ServerEventEmissionReport<EventContract, TRuntimeContext>;
  }

  function createServerEventDeliveries<TEvent extends EventContract>(
    emission: ServerEventEmission<TEvent, TRuntimeContext>,
    routes: readonly ServerEventRoute[]
  ): readonly ServerEventDelivery<TEvent, TRuntimeContext>[] {
    const deliveries: ServerEventDelivery<TEvent, TRuntimeContext>[] = [];

    for (const route of routes) {
      const expandedDeliveries = expandServerEventRoute(route, emission);

      if (expandedDeliveries !== undefined) {
        deliveries.push(...expandedDeliveries);
        continue;
      }

      deliveries.push(
        Object.freeze({
          ...emission,
          route
        }) as ServerEventDelivery<TEvent, TRuntimeContext>
      );
    }

    return Object.freeze([...deliveries]) as readonly ServerEventDelivery<
      TEvent,
      TRuntimeContext
    >[];
  }

  function expandServerEventRoute<TEvent extends EventContract>(
    route: ServerEventRoute,
    emission: ServerEventEmission<TEvent, TRuntimeContext>
  ): readonly ServerEventDelivery<TEvent, TRuntimeContext>[] | undefined {
    const channelId = readChannelAudienceRouteId(route);

    if (channelId === undefined) {
      return undefined;
    }

    const membershipBucket = channelMemberships.get(channelId);

    if (membershipBucket === undefined || membershipBucket.size === 0) {
      return Object.freeze([]) as readonly ServerEventDelivery<
        TEvent,
        TRuntimeContext
      >[];
    }

    const deliveries = [...membershipBucket.values()].map((membership) =>
      Object.freeze({
        ...emission,
        route: freezeMemberScopedServerRoute(route, membership.memberId),
        recipient: Object.freeze({
          memberId: membership.memberId,
          context: membership.context
        }) as ServerEventRecipient<TRuntimeContext>
      }) as ServerEventDelivery<TEvent, TRuntimeContext>
    );

    return Object.freeze(deliveries) as readonly ServerEventDelivery<
      TEvent,
      TRuntimeContext
    >[];
  }
  const lifecycleBridge = Object.freeze({
    notifyConnected: async (
      connection: ServerConnectionLifecycle<TRuntimeContext>
    ) => {
      if (lifecycleHooks.onConnect === undefined) {
        return;
      }

      await callServerLifecycleHook(
        () => lifecycleHooks.onConnect!(freezeServerConnectionLifecycle(connection)),
        {
          stage: "connect",
          target: connection.connectionId
        }
      );
    },
    notifyDisconnected: async (
      connection: ServerConnectionLifecycle<TRuntimeContext>
    ) => {
      if (lifecycleHooks.onDisconnect === undefined) {
        return;
      }

      await callServerLifecycleHook(
        () =>
          lifecycleHooks.onDisconnect!(
            freezeServerConnectionLifecycle(connection)
          ),
        {
          stage: "disconnect",
          target: connection.connectionId
        }
      );
    }
  });

  return Object.freeze({
    registry,
    [SERVER_RUNTIME_LIFECYCLE_BRIDGE]: lifecycleBridge,
    inspectContracts() {
      return contractIntrospection;
    },
    inspectRuntime() {
      const activeChannels = Object.freeze(
        [...activeChannelInstances.entries()].map(([bucketKey, instance]) => {
          const membershipBucket = channelMemberships.get(bucketKey);
          const memberIds = Object.freeze(
            membershipBucket === undefined ? [] : [...membershipBucket.keys()]
          );

          return Object.freeze({
            contract: instance.contract,
            name: instance.name,
            key: instance.key,
            memberCount: memberIds.length,
            memberIds
          });
        })
      ) as readonly ServerRuntimeActiveChannelDebug<
        TRegistry["channels"]["list"][number]
      >[];

      return Object.freeze({
        state: "ready" as const,
        contracts: contractIntrospection,
        connectionPolicyNames,
        commandHandlerNames,
        eventRouterNames,
        eventDelivererNames,
        activeChannels
      });
    },
    async authorizeConnection(
      executionOptions?: ExecuteServerConnectionOptions<TRuntimeContext>
    ) {
      const normalizedOptions =
        executionOptions ??
        ({} as ExecuteServerConnectionOptions<TRuntimeContext>);

      for (const contract of connectionPolicies) {
        const policyError = await evaluatePolicyContract(
          contract,
          {
            context: normalizedOptions.context as TRuntimeContext
          },
          {
            defaultCode: "connection-denied",
            defaultMessage: `Connection is denied by policy: "${contract.name}".`,
            stage: "connect"
          }
        );

        if (policyError !== undefined) {
          throw policyError;
        }
      }
    },
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
      executionOptions?: ExecuteServerCommandOptions<TRuntimeContext>
    ) {
      const normalizedOptions =
        executionOptions ??
        ({} as ExecuteServerCommandOptions<TRuntimeContext>);

      const contract = registry.commands.byName[
        name as keyof typeof registry.commands.byName
      ] as CommandContract | undefined;

      if (contract === undefined) {
        throw createUnknownServerContractError(
          "command",
          name,
          Object.keys(registry.commands.byName)
        );
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
        context: normalizedOptions.context as TRuntimeContext
      } as ServerCommandExecution<CommandContract, TRuntimeContext>;
      const policies = commandPolicies[
        name as keyof typeof commandPolicies
      ] as
        | readonly CommandPolicyContract<
            string,
            CommandContract,
            TRuntimeContext
          >[]
        | undefined;
      const authorizer = commandAuthorizers[
        name as keyof typeof commandAuthorizers
      ] as
        | ServerCommandAuthorizer<CommandContract, TRuntimeContext>
        | undefined;

      if (policies !== undefined) {
        for (const policy of policies) {
          const policyError = await evaluatePolicyContract(
            policy,
            execution,
            {
              defaultCode: "forbidden",
              defaultMessage: `Command execution is denied by policy: "${policy.name}".`,
              stage: "command"
            }
          );

          if (policyError !== undefined) {
            throw policyError;
          }
        }
      }

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
      executionOptions?: ExecuteServerEventOptions<TRuntimeContext>
    ) {
      const report = await emitServerEventReport(name, payload, executionOptions);

      return report.delivered;
    },
    async emitEventReport(
      name: string,
      payload: unknown,
      executionOptions?: ExecuteServerEventOptions<TRuntimeContext>
    ) {
      return emitServerEventReport(name, payload, executionOptions);
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
        throw createUnknownServerContractError(
          "channel",
          name,
          Object.keys(registry.channels.byName)
        );
      }

      const instance = createChannelInstance(contract, key);
      const joinExecution = {
        contract,
        name: contract.name,
        key: instance.key,
        memberId: executionOptions.memberId,
        context: executionOptions.context
      } as ServerChannelJoinExecution<ChannelContract, TRuntimeContext>;
      const joinPolicies = channelJoinPolicies[
        name as keyof typeof channelJoinPolicies
      ] as
        | readonly JoinPolicyContract<
            string,
            ChannelContract,
            TRuntimeContext
          >[]
        | undefined;
      const authorizer = channelJoinAuthorizers[
        name as keyof typeof channelJoinAuthorizers
      ] as
        | ServerChannelJoinAuthorizer<ChannelContract, TRuntimeContext>
        | undefined;

      if (joinPolicies !== undefined) {
        for (const policy of joinPolicies) {
          const policyError = await evaluatePolicyContract(
            policy,
            joinExecution,
            {
              defaultCode: "join-denied",
              defaultMessage: `Channel join is denied by policy: "${policy.name}".`,
              stage: "join"
            }
          );

          if (policyError !== undefined) {
            throw policyError;
          }
        }
      }

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

      activeChannelInstances.set(membershipBucketKey, {
        contract,
        name: contract.name,
        key: instance.key
      });
      membershipBucket.set(executionOptions.memberId, membership);

      if (lifecycleHooks.onJoin !== undefined) {
        try {
          await lifecycleHooks.onJoin(
            membership as ServerJoinLifecycleExecution<TRegistry, TRuntimeContext>
          );
        } catch (error) {
          membershipBucket.delete(executionOptions.memberId);

          if (membershipBucket.size === 0) {
            channelMemberships.delete(membershipBucketKey);
            activeChannelInstances.delete(membershipBucketKey);
          }

          throw normalizeServerLifecycleError(error, "join", name);
        }
      }

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
        throw createUnknownServerContractError(
          "channel",
          name,
          Object.keys(registry.channels.byName)
        );
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

      const membership = membershipBucket.get(
        executionOptions.memberId
      ) as ChannelMembership<ChannelContract, TRuntimeContext> | undefined;
      const deleted = membershipBucket.delete(executionOptions.memberId);

      if (membershipBucket.size === 0) {
        channelMemberships.delete(membershipBucketKey);
        activeChannelInstances.delete(membershipBucketKey);
      }

      if (deleted && membership !== undefined && lifecycleHooks.onLeave !== undefined) {
        const leaveExecution = Object.freeze({
          contract: membership.contract,
          name: membership.name,
          key: membership.key,
          memberId: membership.memberId,
          context: membership.context
        }) as ServerChannelLeaveExecution<ChannelContract, TRuntimeContext>;

        await callServerLifecycleHook(
          () =>
            lifecycleHooks.onLeave!(
              leaveExecution as ServerLeaveLifecycleExecution<
                TRegistry,
                TRuntimeContext
              >
            ),
          {
            stage: "leave",
            target: name
          }
        );
      }

      return deleted;
    },
    listChannelMembers(name: string, key: unknown) {
      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw createUnknownServerContractError(
          "channel",
          name,
          Object.keys(registry.channels.byName)
        );
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
  }) as unknown as ServerRuntime<TRuntimeContext, TRegistry>;
}

/**
 * Создает server runtime с усиленным authoring-time inference публичного API.
 * Runtime-поведение полностью делегируется обычному `createServerRuntime`.
 */
export function defineServerRuntime<
  TRegistry extends ContractRegistry,
  TConnectionPolicies extends
    | ServerConnectionPolicies<any>
    | undefined = undefined,
  TCommandPolicies extends
    | ServerCommandPolicies<TRegistry, any>
    | undefined = undefined,
  TCommandHandlers extends
    | ServerCommandHandlers<TRegistry, any>
    | undefined = undefined,
  TCommandAuthorizers extends
    | ServerCommandAuthorizers<TRegistry, any>
    | undefined = undefined,
  TEventRouters extends
    | ServerEventRouters<TRegistry, any>
    | undefined = undefined,
  TEventReceivePolicies extends
    | ServerEventReceivePolicies<TRegistry, any>
    | undefined = undefined,
  TEventDeliverers extends
    | ServerEventDeliverers<TRegistry, any>
    | undefined = undefined,
  TChannelJoinPolicies extends
    | ServerChannelJoinPolicies<TRegistry, any>
    | undefined = undefined,
  TChannelJoinAuthorizers extends
    | ServerChannelJoinAuthorizers<TRegistry, any>
    | undefined = undefined,
  TLifecycleHooks extends
    | ServerLifecycleHooks<TRegistry, any>
    | undefined = undefined,
  TRuntimeContext = InferServerRuntimeContext<
    TConnectionPolicies,
    TCommandPolicies,
    TCommandHandlers,
    TCommandAuthorizers,
    TEventRouters,
    TEventReceivePolicies,
    TEventDeliverers,
    TChannelJoinPolicies,
    TChannelJoinAuthorizers,
    TLifecycleHooks
  >
>(
  options: DefineServerRuntimeOptions<
    TRegistry,
    TConnectionPolicies,
    TCommandPolicies,
    TCommandHandlers,
    TCommandAuthorizers,
    TEventRouters,
    TEventReceivePolicies,
    TEventDeliverers,
    TChannelJoinPolicies,
    TChannelJoinAuthorizers,
    TLifecycleHooks,
    TRuntimeContext
  >
): ServerRuntime<TRuntimeContext, TRegistry> {
  return createServerRuntime<TRuntimeContext, TRegistry>(options);
}

interface ServerRuntimeLifecycleBridge<TRuntimeContext = unknown> {
  readonly [SERVER_RUNTIME_LIFECYCLE_BRIDGE]: {
    readonly notifyConnected: (
      connection: ServerConnectionLifecycle<TRuntimeContext>
    ) => Promise<void>;
    readonly notifyDisconnected: (
      connection: ServerConnectionLifecycle<TRuntimeContext>
    ) => Promise<void>;
  };
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

function normalizeServerLifecycleError(
  error: unknown,
  stage: "connect" | "disconnect" | "join" | "leave",
  target: string
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Server lifecycle hook failed at stage "${stage}": "${target}".`,
    details: {
      stage,
      target
    },
    cause: error
  });
}

function getChannelMembershipBucketKey(
  channelName: string,
  key: ChannelKey<ChannelContract>
): string {
  return stringifyChannelInstance(channelName, key);
}

function readChannelAudienceRouteId(route: ServerEventRoute): string | undefined {
  if (route.target !== "channel") {
    return undefined;
  }

  const channelId = route.metadata?.channelId;

  if (typeof channelId !== "string" || channelId.length === 0) {
    return undefined;
  }

  if (typeof route.metadata?.memberId === "string") {
    return undefined;
  }

  return channelId;
}

function freezeMemberScopedServerRoute(
  route: ServerEventRoute,
  memberId: string
): ServerEventRoute {
  const metadata =
    route.metadata === undefined
      ? Object.freeze({
          memberId
        })
      : Object.freeze({
          ...route.metadata,
          memberId
        });

  return Object.freeze({
    target: route.target,
    metadata
  });
}

async function callServerLifecycleHook(
  run: () => Promise<void> | void,
  options: {
    readonly stage: "connect" | "disconnect" | "join" | "leave";
    readonly target: string;
  }
) {
  try {
    await run();
  } catch (error) {
    throw normalizeServerLifecycleError(error, options.stage, options.target);
  }
}

function freezeServerConnectionLifecycle<TRuntimeContext>(
  connection: ServerConnectionLifecycle<TRuntimeContext>
): ServerConnectionLifecycle<TRuntimeContext> {
  return Object.freeze({
    connectionId: connection.connectionId,
    context: connection.context
  });
}

/**
 * Выполняет policy-контракт и возвращает нормализованную realtime-ошибку,
 * если правило явно отклонило операцию или упало во время вычисления.
 */
async function evaluatePolicyContract<
  TContext,
  TCode extends RealtimeErrorCode
>(
  contract: PolicyContract<string, TContext, any, TCode>,
  context: TContext,
  options: {
    readonly defaultCode: TCode;
    readonly defaultMessage: string;
    readonly stage: "connect" | "join" | "command" | "receive";
  }
) {
  try {
    const result = await contract.evaluate(context);

    return createPolicyRejectionError(
      result,
      options.defaultCode,
      options.defaultMessage
    );
  } catch (error) {
    return normalizePolicyEvaluationError(error, contract.name, options.stage);
  }
}

/**
 * Превращает deny-результат policy в единый realtime error shape.
 */
function createPolicyRejectionError<TCode extends RealtimeErrorCode>(
  result: PolicyResolution<TCode>,
  defaultCode: TCode,
  defaultMessage: string
) {
  if (isPolicyAllowed(result)) {
    return undefined;
  }

  if (isPolicyDenyDecision(result)) {
    const errorOptions = {
      code: result.code ?? defaultCode,
      message: result.message ?? defaultMessage,
      cause: result
    };

    if (result.details !== undefined) {
      return createRealtimeError({
        ...errorOptions,
        details: result.details
      });
    }

    return createRealtimeError(errorOptions);
  }

  return createRealtimeError({
    code: defaultCode,
    message: defaultMessage
  });
}

/**
 * Нормализует исключение из policy evaluator в предсказуемый internal-error.
 */
function normalizePolicyEvaluationError(
  error: unknown,
  policyName: string,
  stage: "connect" | "join" | "command" | "receive"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Policy evaluation failed at stage "${stage}": "${policyName}".`,
    details: {
      policyName,
      stage
    },
    cause: error
  });
}

function isPolicyAllowed(result: PolicyResolution<RealtimeErrorCode>): boolean {
  if (typeof result === "boolean") {
    return result;
  }

  return result.allowed;
}

function isPolicyDenyDecision(
  result: PolicyResolution<RealtimeErrorCode>
): result is PolicyDenyDecision<RealtimeErrorCode> {
  return typeof result === "object" && result !== null && result.allowed === false;
}

function createUnknownServerContractError(
  kind: "command" | "event" | "channel",
  name: string,
  registeredNames: readonly string[]
): TypeError {
  return new TypeError(
    `Unknown ${kind} contract: "${name}". ${formatRegisteredServerContractNames(kind, registeredNames)}`
  );
}

function formatRegisteredServerContractNames(
  kind: "command" | "event" | "channel",
  registeredNames: readonly string[]
): string {
  const label = `${kind}s`;

  if (registeredNames.length === 0) {
    return `Registered ${label}: none.`;
  }

  return `Registered ${label}: ${registeredNames.join(", ")}.`;
}
