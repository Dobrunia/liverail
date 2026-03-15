import type {
  ChannelKey,
  ChannelContract,
  CommandAck,
  CommandContract,
  CommandResult,
  ContractRegistryIntrospection,
  ContractRegistry,
  EventContract,
  EventPayload,
  SystemConnectionLifecycleState,
  SystemEventName,
  SystemEventPayload,
  ResolveSchemaInput
} from "@dobrunia-liverail/contracts";
import {
  createChannelInstance,
  createSystemEvent,
  createRealtimeError,
  inspectContractRegistry,
  isRealtimeError,
  parseCommandAck,
  parseCommandInput,
  parseEventPayload
} from "@dobrunia-liverail/contracts";
import type {
  ClientEventListener,
  ClientSystemEventListener
} from "../events/index.ts";
import {
  reportClientRuntimeError,
  type ClientRuntimeErrorHandler,
  warnClientRuntimeMisuse
} from "../errors/index.ts";
import type {
  ClientEventApplierDefinition,
  ClientStateStore
} from "../appliers/index.ts";
import type {
  ClientChannelSubscription,
} from "../subscriptions/index.ts";
import {
  getClientChannelSubscriptionKey
} from "../subscriptions/index.ts";
import type {
  ClientTransport,
  ClientTransportConnectionEvent,
  ClientTransportConnectionReceiver,
  ClientTransportChannelRequest,
  ClientTransportCommandRequest,
  ClientTransportEvent,
  ClientTransportEventReceiver
} from "../transport/index.ts";

type CommandName<TRegistry extends ContractRegistry> =
  keyof TRegistry["commands"]["byName"] & string;
type EventName<TRegistry extends ContractRegistry> =
  keyof TRegistry["events"]["byName"] & string;
type ChannelName<TRegistry extends ContractRegistry> =
  keyof TRegistry["channels"]["byName"] & string;

const DEFAULT_CLIENT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_CLIENT_CHANNEL_OPERATION_TIMEOUT_MS = 15_000;

/**
 * Параметры создания transport-agnostic client runtime.
 */
export interface CreateClientRuntimeOptions<
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Единый registry-контрактов, вокруг которого строится runtime.
   */
  readonly registry: TRegistry;

  /**
   * Необязательный transport adapter для inbound/outbound связки.
   */
  readonly transport?: ClientTransport;

  /**
   * Необязательный hook для нормализованных client runtime ошибок.
   */
  readonly onError?: ClientRuntimeErrorHandler;

  /**
   * Необязательный дефолтный timeout ожидания результата команды в миллисекундах.
   */
  readonly commandTimeoutMs?: number | false;

  /**
   * Необязательный дефолтный timeout channel subscribe/unsubscribe в миллисекундах.
   */
  readonly channelOperationTimeoutMs?: number | false;
}

/**
 * Базовый client runtime, который знает про registry и lifecycle transport-а.
 */
export interface ClientRuntime<
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Явный registry-контрактов, используемый клиентским runtime.
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
   * Возвращает текущее состояние transport-agnostic connection lifecycle.
   */
  inspectConnection(): ClientConnectionLifecycleSnapshot;

  /**
   * Регистрирует listener изменений connection lifecycle и возвращает cleanup.
   */
  onConnectionState(listener: ClientConnectionStateListener): () => void;

  /**
   * Возвращает read-only debug snapshot текущего client runtime состояния.
   */
  inspectRuntime(): ClientRuntimeDebugSnapshot<TRegistry>;

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
   * Выполняет typed command client flow: validate input -> transport -> validate ack.
   */
  executeCommand<TName extends CommandName<TRegistry>>(
    name: TName,
    input: ResolveSchemaInput<TRegistry["commands"]["byName"][TName]["input"]>,
    options?: ExecuteClientCommandOptions
  ): Promise<CommandAck<TRegistry["commands"]["byName"][TName]>>;

  /**
   * Подписывает клиента на typed channel instance.
   */
  subscribeChannel<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>,
    options?: ExecuteClientChannelOperationOptions
  ): Promise<ClientChannelSubscription<TRegistry["channels"]["byName"][TName]>>;

  /**
   * Отписывает клиента от typed channel instance.
   */
  unsubscribeChannel<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>,
    options?: ExecuteClientChannelOperationOptions
  ): Promise<boolean>;

  /**
   * Регистрирует typed listener конкретного события и возвращает cleanup.
   */
  onEvent<TName extends EventName<TRegistry>>(
    name: TName,
    listener: ClientEventListener<TRegistry["events"]["byName"][TName]>
  ): () => void;

  /**
   * Регистрирует listener отдельного system event и возвращает cleanup.
   */
  onSystemEvent<TName extends SystemEventName>(
    name: TName,
    listener: ClientSystemEventListener<TName>
  ): () => void;

  /**
   * Регистрирует typed event applier по event contract и store-agnostic state accessor.
   */
  registerEventApplier<
    TName extends EventName<TRegistry>,
    TState
  >(
    applier: ClientEventApplierDefinition<
      TRegistry["events"]["byName"][TName],
      TState
    >,
    stateStore: ClientStateStore<TState>
  ): () => void;

  /**
   * Завершает transport binding и освобождает локальные ресурсы runtime.
   */
  destroy(): void;
}

/**
 * Внутренняя runtime-запись зарегистрированного event applier.
 */
interface RegisteredClientEventApplier {
  /**
   * Имя события, к которому привязан applier.
   */
  readonly eventName: string;

  /**
   * Применяет уже провалидированный payload к пользовательскому состоянию.
   */
  readonly apply: (payload: unknown) => void;
}

/**
 * Официальные состояния transport-agnostic client connection lifecycle.
 */
export type ClientConnectionLifecycleState = SystemConnectionLifecycleState;

/**
 * Централизованный snapshot client connection lifecycle.
 */
export interface ClientConnectionLifecycleSnapshot {
  /**
   * Текущее состояние соединения.
   */
  readonly state: ClientConnectionLifecycleState;

  /**
   * Предыдущее состояние, если переход уже происходил.
   */
  readonly previousState?: ClientConnectionLifecycleState;

  /**
   * Признак активного подключенного соединения.
   */
  readonly connected: boolean;

  /**
   * Признак того, что transport присылает connection lifecycle события.
   */
  readonly transportBound: boolean;
}

/**
 * Listener изменений client connection lifecycle.
 */
export type ClientConnectionStateListener = (
  snapshot: ClientConnectionLifecycleSnapshot
) => void;

/**
 * Стабильное operational-состояние client runtime.
 */
export type ClientRuntimeState = "active" | "destroyed";

/**
 * Read-only debug snapshot client runtime.
 */
export interface ClientRuntimeDebugSnapshot<
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Текущее operational-состояние runtime.
   */
  readonly state: ClientRuntimeState;

  /**
   * Текущее состояние transport-agnostic connection lifecycle.
   */
  readonly connectionState: ClientConnectionLifecycleSnapshot;

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
   * Признак того, что runtime связан хотя бы с одним transport adapter.
   */
  readonly transportBound: boolean;

  /**
   * Активные клиентские подписки.
   */
  readonly activeSubscriptions: readonly ClientChannelSubscription<
    TRegistry["channels"]["list"][number]
  >[];

  /**
   * Имена событий, для которых сейчас есть listener-ы.
   */
  readonly eventListenerNames: readonly EventName<TRegistry>[];

  /**
   * Текущее число listener-ов по имени события.
   */
  readonly eventListenerCounts: Readonly<Record<string, number>>;

  /**
   * Имена событий, для которых сейчас зарегистрированы applier-ы.
   */
  readonly eventApplierNames: readonly EventName<TRegistry>[];
}

/**
 * Параметры выполнения typed команды в client runtime.
 */
export interface ExecuteClientCommandOptions {
  /**
   * Необязательный timeout ожидания transport result в миллисекундах.
   */
  readonly timeoutMs?: number | false;

  /**
   * Необязательный AbortSignal для раннего завершения ожидания команды.
   */
  readonly signal?: AbortSignal;
}

/**
 * Параметры subscribe/unsubscribe channel operations в client runtime.
 */
export interface ExecuteClientChannelOperationOptions {
  /**
   * Необязательный timeout ожидания transport result в миллисекундах.
   */
  readonly timeoutMs?: number | false;

  /**
   * Необязательный AbortSignal для раннего завершения channel operation.
   */
  readonly signal?: AbortSignal;
}

/**
 * Создает базовый client runtime вокруг explicit contract registry.
 */
export function createClientRuntime<
  TRegistry extends ContractRegistry = ContractRegistry
>(
  options: CreateClientRuntimeOptions<TRegistry>
): ClientRuntime<TRegistry> {
  if (options?.registry === undefined) {
    throw new TypeError("Client runtime requires a contract registry.");
  }

  const { registry } = options;
  const transport = options.transport;
  const onError = options.onError;
  const defaultCommandTimeoutMs = resolveClientTimeoutMs(
    options.commandTimeoutMs,
    DEFAULT_CLIENT_COMMAND_TIMEOUT_MS,
    "Client default command timeout"
  );
  const defaultChannelOperationTimeoutMs = resolveClientTimeoutMs(
    options.channelOperationTimeoutMs,
    DEFAULT_CLIENT_CHANNEL_OPERATION_TIMEOUT_MS,
    "Client default channel operation timeout"
  );
  const channelSubscriptions = new Map<
    string,
    ClientChannelSubscription<ChannelContract>
  >();
  const channelOperationChains = new Map<string, Promise<unknown>>();
  const eventAppliers = new Map<string, Set<RegisteredClientEventApplier>>();
  const eventListeners = new Map<
    string,
    Set<ClientEventListener<EventContract>>
  >();
  const systemEventListeners = new Map<
    SystemEventName,
    Set<ClientSystemEventListener<SystemEventName>>
  >();
  const transportEventReceiver = createTransportEventReceiver(
    registry,
    channelSubscriptions,
    eventAppliers,
    eventListeners,
    reportRuntimeError
  );
  const hasConnectionTransport = transport?.bindConnection !== undefined;
  const connectionStateListeners = new Set<ClientConnectionStateListener>();
  let connectionState = createClientConnectionLifecycleSnapshot(
    hasConnectionTransport ? "connecting" : "idle",
    undefined,
    hasConnectionTransport
  );
  const transportConnectionReceiver = createTransportConnectionReceiver(
    channelSubscriptions,
    scheduleChannelResubscribe,
    (event) => {
      transitionClientConnectionState(event.status, event.error);
    }
  );
  const unbindTransportConnection = transport?.bindConnection?.(
    transportConnectionReceiver
  );
  const unbindTransportEvents = transport?.bindEvents?.(transportEventReceiver);
  const contractIntrospection = inspectContractRegistry(registry);
  const transportBound = transport !== undefined;
  let isDestroyed = false;

  function reportRuntimeError(error: ReturnType<typeof createRealtimeError>): void {
    reportClientRuntimeError(error, onError);
  }

  function emitJoinFailed(
    channelName: string,
    key: ChannelKey<ChannelContract>,
    error: ReturnType<typeof createRealtimeError>
  ): void {
    emitSystemEvent("join_failed", {
      channelName,
      key,
      error: error.toJSON()
    });
  }

  function enqueueChannelOperation<T>(
    subscriptionKey: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const previousOperation = channelOperationChains.get(subscriptionKey);
    const scheduledOperation =
      previousOperation === undefined
        ? (async () => {
            assertClientRuntimeIsActive(
              isDestroyed,
              "manage channel subscriptions"
            );

            return operation();
          })()
        : Promise.resolve(previousOperation)
            .catch(() => undefined)
            .then(async () => {
              assertClientRuntimeIsActive(
                isDestroyed,
                "manage channel subscriptions"
              );

              return operation();
            });

    const trackedOperation = scheduledOperation.finally(() => {
      if (channelOperationChains.get(subscriptionKey) === trackedOperation) {
        channelOperationChains.delete(subscriptionKey);
      }
    });

    channelOperationChains.set(subscriptionKey, trackedOperation);

    return trackedOperation;
  }

  function scheduleChannelResubscribe(
    subscription: ClientChannelSubscription<ChannelContract>
  ): void {
    if (transport?.subscribeChannel === undefined) {
      return;
    }

    const subscriptionKey = getClientChannelSubscriptionKey(
      subscription.name,
      subscription.key
    );

    void enqueueChannelOperation(subscriptionKey, async () => {
      const currentSubscription = channelSubscriptions.get(subscriptionKey);

      if (currentSubscription === undefined || currentSubscription !== subscription) {
        return;
      }

      const request = {
        name: subscription.name,
        key: subscription.key
      } satisfies ClientTransportChannelRequest;

      try {
        await resolveClientTransportOperation(
          () => transport.subscribeChannel!(request),
          {
            timeoutMs: defaultChannelOperationTimeoutMs,
            signal: undefined,
            createTimeoutError: () =>
              createClientChannelOperationTimeoutError(
                subscription.name,
                "resubscribe",
                defaultChannelOperationTimeoutMs
              ),
            createAbortError: () =>
              createClientChannelOperationAbortError(
                subscription.name,
                "resubscribe"
              )
          }
        );
      } catch (error) {
        const normalizedError = normalizeClientChannelOperationFailure(
          error,
          subscription.name,
          "resubscribe"
        );

        channelSubscriptions.delete(subscriptionKey);
        reportRuntimeError(normalizedError);
        emitJoinFailed(subscription.name, subscription.key, normalizedError);
      }
    });
  }

  return Object.freeze({
    registry,
    inspectContracts() {
      return contractIntrospection;
    },
    inspectConnection() {
      return connectionState;
    },
    onConnectionState(listener: ClientConnectionStateListener) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "register connection listeners"
      );

      connectionStateListeners.add(listener);

      return () => {
        connectionStateListeners.delete(listener);
      };
    },
    inspectRuntime() {
      const activeSubscriptions = Object.freeze(
        [...channelSubscriptions.values()]
      ) as readonly ClientChannelSubscription<
        TRegistry["channels"]["list"][number]
      >[];
      const eventListenerNames = Object.freeze(
        [...eventListeners.keys()]
      ) as readonly EventName<TRegistry>[];
      const eventApplierNames = Object.freeze(
        [...eventAppliers.keys()]
      ) as readonly EventName<TRegistry>[];
      const eventListenerCounts = Object.freeze(
        Object.fromEntries(
          [...eventListeners.entries()].map(([name, bucket]) => [
            name,
            bucket.size
          ])
        )
      ) as Readonly<Record<string, number>>;

      return Object.freeze({
        state: isDestroyed ? "destroyed" : "active",
        connectionState,
        contracts: contractIntrospection,
        transportBound,
        activeSubscriptions,
        eventListenerNames,
        eventListenerCounts,
        eventApplierNames
      });
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
    async executeCommand(
      name: string,
      input: unknown,
      executionOptions: ExecuteClientCommandOptions = {}
    ) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "execute commands"
      );

      const contract = registry.commands.byName[
        name as keyof typeof registry.commands.byName
      ] as CommandContract | undefined;

      if (contract === undefined) {
        throw createUnknownClientContractError(
          "command",
          name,
          Object.keys(registry.commands.byName)
        );
      }

      if (transport?.sendCommand === undefined) {
        throw new TypeError("Client transport does not support command execution.");
      }

      const parsedInput = parseCommandInput(contract, input);
      const request = {
        name: contract.name,
        input: parsedInput
      } satisfies ClientTransportCommandRequest;
      const timeoutMs = resolveClientTimeoutMs(
        executionOptions.timeoutMs,
        defaultCommandTimeoutMs,
        "Client command timeout"
      );

      try {
        const result = await resolveClientCommandResult(
          transport.sendCommand,
          request,
          name,
          timeoutMs,
          executionOptions.signal
        );

        if (result.status === "missing-ack") {
          throw createRealtimeError({
            code: "missing-ack",
            message: `Command ack is missing: "${name}".`
          });
        }

        if (result.status === "timeout") {
          throw createRealtimeError({
            code: "timeout",
            message: `Command timed out: "${name}".`,
            details:
              timeoutMs === undefined
                ? {
                    commandName: name
                  }
                : {
                    commandName: name,
                    timeoutMs
                  }
          });
        }

        if (result.status === "error") {
          if (isRealtimeError(result.error)) {
            throw result.error;
          }

          throw normalizeClientCommandTransportFailure(result.error, name);
        }

        return parseCommandAck(contract, result.ack);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeClientCommandTransportFailure(error, name);
      }
    },
    async subscribeChannel(
      name: string,
      key: unknown,
      operationOptions: ExecuteClientChannelOperationOptions = {}
    ) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "manage channel subscriptions"
      );

      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw createUnknownClientContractError(
          "channel",
          name,
          Object.keys(registry.channels.byName)
        );
      }

      if (transport?.subscribeChannel === undefined) {
        throw new TypeError("Client transport does not support channel subscriptions.");
      }

      const instance = createChannelInstance(contract, key);
      const subscriptionKey = getClientChannelSubscriptionKey(name, instance.key);
      const request = {
        name: contract.name,
        key: instance.key
      } satisfies ClientTransportChannelRequest;

      return enqueueChannelOperation(subscriptionKey, async () => {
        const existingSubscription = channelSubscriptions.get(subscriptionKey);

        if (existingSubscription !== undefined) {
          warnClientRuntimeMisuse(
            `Channel subscription is already active: "${name}" with key ${JSON.stringify(instance.key)}.`
          );
          return existingSubscription as ClientChannelSubscription<ChannelContract>;
        }

        const timeoutMs = resolveClientTimeoutMs(
          operationOptions.timeoutMs,
          defaultChannelOperationTimeoutMs,
          "Client channel operation timeout"
        );

        try {
          await resolveClientTransportOperation(
            () => transport.subscribeChannel!(request),
            {
              timeoutMs,
              signal: operationOptions.signal,
              createTimeoutError: () =>
                createClientChannelOperationTimeoutError(
                  contract.name,
                  "subscribe",
                  timeoutMs
                ),
              createAbortError: () =>
                createClientChannelOperationAbortError(
                  contract.name,
                  "subscribe"
                )
            }
          );
        } catch (error) {
          const normalizedError = normalizeClientChannelOperationFailure(
            error,
            name,
            "subscribe"
          );

          emitJoinFailed(contract.name, instance.key, normalizedError);
          throw normalizedError;
        }

        if (isDestroyed) {
          if (transport.unsubscribeChannel !== undefined) {
            void Promise.resolve(transport.unsubscribeChannel(request)).catch(
              (error: unknown) => {
                reportRuntimeError(
                  normalizeClientChannelOperationFailure(
                    error,
                    name,
                    "unsubscribe"
                  )
                );
              }
            );
          }

          throw new TypeError(
            "Client runtime is destroyed and cannot manage channel subscriptions."
          );
        }

        const subscription = Object.freeze({
          contract,
          name: contract.name,
          key: instance.key,
          id: instance.id
        }) as ClientChannelSubscription<ChannelContract>;

        channelSubscriptions.set(subscriptionKey, subscription);

        return subscription;
      });
    },
    async unsubscribeChannel(
      name: string,
      key: unknown,
      operationOptions: ExecuteClientChannelOperationOptions = {}
    ) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "manage channel subscriptions"
      );

      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw createUnknownClientContractError(
          "channel",
          name,
          Object.keys(registry.channels.byName)
        );
      }

      const instance = createChannelInstance(contract, key);
      const subscriptionKey = getClientChannelSubscriptionKey(name, instance.key);

      if (transport?.unsubscribeChannel === undefined) {
        throw new TypeError("Client transport does not support channel unsubscription.");
      }

      const request = {
        name: contract.name,
        key: instance.key
      } satisfies ClientTransportChannelRequest;

      return enqueueChannelOperation(subscriptionKey, async () => {
        if (!channelSubscriptions.has(subscriptionKey)) {
          return false;
        }

        const timeoutMs = resolveClientTimeoutMs(
          operationOptions.timeoutMs,
          defaultChannelOperationTimeoutMs,
          "Client channel operation timeout"
        );

        try {
          await resolveClientTransportOperation(
            () => transport.unsubscribeChannel!(request),
            {
              timeoutMs,
              signal: operationOptions.signal,
              createTimeoutError: () =>
                createClientChannelOperationTimeoutError(
                  contract.name,
                  "unsubscribe",
                  timeoutMs
                ),
              createAbortError: () =>
                createClientChannelOperationAbortError(
                  contract.name,
                  "unsubscribe"
                )
            }
          );
        } catch (error) {
          throw normalizeClientChannelOperationFailure(
            error,
            name,
            "unsubscribe"
          );
        }

        channelSubscriptions.delete(subscriptionKey);

        return true;
      });
    },
    onEvent(name: string, listener: ClientEventListener<EventContract>) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "register event listeners"
      );

      const contract = registry.events.byName[
        name as keyof typeof registry.events.byName
      ] as EventContract | undefined;

      if (contract === undefined) {
        throw createUnknownClientContractError(
          "event",
          name,
          Object.keys(registry.events.byName)
        );
      }

      let bucket = eventListeners.get(contract.name);

      if (bucket === undefined) {
        bucket = new Set();
        eventListeners.set(contract.name, bucket);
      }

      bucket.add(listener);

      return () => {
        const currentBucket = eventListeners.get(contract.name);

        if (currentBucket === undefined) {
          return;
        }

        currentBucket.delete(listener);

        if (currentBucket.size === 0) {
          eventListeners.delete(contract.name);
        }
      };
    },
    onSystemEvent(
      name: SystemEventName,
      listener: ClientSystemEventListener<SystemEventName>
    ) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "register system event listeners"
      );

      let bucket = systemEventListeners.get(name);

      if (bucket === undefined) {
        bucket = new Set();
        systemEventListeners.set(name, bucket);
      }

      bucket.add(listener);

      return () => {
        const currentBucket = systemEventListeners.get(name);

        if (currentBucket === undefined) {
          return;
        }

        currentBucket.delete(listener);

        if (currentBucket.size === 0) {
          systemEventListeners.delete(name);
        }
      };
    },
    registerEventApplier<
      TName extends EventName<TRegistry>,
      TState
    >(
      applier: ClientEventApplierDefinition<
        TRegistry["events"]["byName"][TName],
        TState
      >,
      stateStore: ClientStateStore<TState>
    ) {
      assertClientRuntimeIsActive(
        isDestroyed,
        "register event appliers"
      );

      const contract = registry.events.byName[
        applier.event.name as keyof typeof registry.events.byName
      ] as TRegistry["events"]["byName"][TName] | undefined;

      if (contract === undefined || contract !== applier.event) {
        throw new TypeError(
          `Event applier must use an event contract from the client registry: "${applier.event.name}".`
        );
      }

      const registration = {
        eventName: contract.name,
        apply(payload: unknown) {
          const nextState = applier.apply(
            stateStore.getState(),
            payload as EventPayload<TRegistry["events"]["byName"][TName]>
          );

          stateStore.setState(nextState);
        }
      } satisfies RegisteredClientEventApplier;
      let bucket = eventAppliers.get(contract.name);

      if (bucket === undefined) {
        bucket = new Set();
        eventAppliers.set(contract.name, bucket);
      }

      bucket.add(registration);

      return () => {
        const currentBucket = eventAppliers.get(contract.name);

        if (currentBucket === undefined) {
          return;
        }

        currentBucket.delete(registration);

        if (currentBucket.size === 0) {
          eventAppliers.delete(contract.name);
        }
      };
    },
    destroy() {
      if (isDestroyed) {
        warnClientRuntimeMisuse(
          "Client runtime is already destroyed; repeated destroy() is ignored."
        );
        return;
      }

      isDestroyed = true;
      const subscriptionsToCleanup = [...channelSubscriptions.values()];

      if (transport?.unsubscribeChannel !== undefined) {
        for (const subscription of subscriptionsToCleanup) {
          const request = {
            name: subscription.name,
            key: subscription.key
          } satisfies ClientTransportChannelRequest;

          void Promise.resolve(transport.unsubscribeChannel(request)).catch(
            (error: unknown) => {
              const normalizedError = isRealtimeError(error)
                ? error
                : normalizeClientChannelOperationTransportError(
                    error,
                    subscription.name,
                    "unsubscribe"
                  );

              reportRuntimeError(normalizedError);
            }
          );
        }
      }

      transitionClientConnectionState(
        hasConnectionTransport ? "disconnected" : "idle"
      );
      eventAppliers.clear();
      eventListeners.clear();
      systemEventListeners.clear();
      channelSubscriptions.clear();
      channelOperationChains.clear();
      unbindTransportConnection?.();
      unbindTransportEvents?.();
      transport?.dispose?.();
    }
  }) as ClientRuntime<TRegistry>;

  function transitionClientConnectionState(
    nextState: ClientConnectionLifecycleState,
    error?: unknown
  ): void {
    const previousState = connectionState.state;

    if (previousState === nextState && error === undefined) {
      return;
    }

    connectionState = createClientConnectionLifecycleSnapshot(
      nextState,
      previousState,
      hasConnectionTransport
    );

    if (nextState === "failed" && error !== undefined) {
      const normalizedError = normalizeClientConnectionLifecycleError(error);

      reportRuntimeError(normalizedError);
      emitSystemEvent("connection_failed", {
        state: "failed",
        previousState,
        error: normalizedError.toJSON()
      });
    } else if (nextState === "connected") {
      if (
        previousState === "reconnecting" ||
        previousState === "disconnected" ||
        previousState === "failed"
      ) {
        emitSystemEvent("reconnect_succeeded", {
          state: "connected",
          previousState
        });
      } else {
        emitSystemEvent("connected", {
          state: "connected",
          previousState
        });
      }
    } else if (nextState === "disconnected") {
      emitSystemEvent("disconnected", {
        state: "disconnected",
        previousState
      });
    } else if (nextState === "reconnecting") {
      emitSystemEvent("reconnect_started", {
        state: "reconnecting",
        previousState
      });
    }

    for (const listener of [...connectionStateListeners]) {
      try {
        listener(connectionState);
      } catch (error) {
        reportRuntimeError(
          normalizeClientConnectionListenerError(error, connectionState.state)
        );
      }
    }
  }

  function emitSystemEvent<TName extends SystemEventName>(
    name: TName,
    payload: SystemEventPayload<TName>
  ): void {
    const bucket = systemEventListeners.get(name);

    if (bucket === undefined) {
      return;
    }

    const systemEvent = createSystemEvent(name, payload);

    for (const listener of [...bucket]) {
      try {
        (listener as ClientSystemEventListener<TName>)(systemEvent);
      } catch (error) {
        reportRuntimeError(
          normalizeClientSystemEventListenerError(error, name)
        );
      }
    }
  }
}

/**
 * Создает receiver lifecycle-событий transport соединения и безопасно
 * восстанавливает активные подписки после reconnect.
 * Если повторная подписка не удалась, runtime не оставляет ложное `active`
 * состояние локально и публикует официальный `join_failed`.
 */
function createTransportConnectionReceiver(
  channelSubscriptions: Map<string, ClientChannelSubscription<ChannelContract>>,
  resubscribeChannel: (
    subscription: ClientChannelSubscription<ChannelContract>
  ) => void,
  onConnectionEvent: (event: ClientTransportConnectionEvent) => void
): ClientTransportConnectionReceiver {
  let shouldResubscribe = false;

  return (event: ClientTransportConnectionEvent) => {
    onConnectionEvent(event);

    if (event.status === "failed" || event.status === "connecting") {
      return;
    }

    if (event.status === "reconnecting") {
      shouldResubscribe = true;
      return;
    }

    if (event.status === "disconnected") {
      shouldResubscribe = true;
      return;
    }

    if (!shouldResubscribe) {
      return;
    }

    shouldResubscribe = false;

    for (const subscription of [...channelSubscriptions.values()]) {
      resubscribeChannel(subscription);
    }
  };
}

/**
 * Создает базовый receiver transport events.
 * Пока core-runtime только фиксирует binding и lifecycle; дальнейшая
 * маршрутизация появится в event-listener слое.
 */
function createTransportEventReceiver(
  registry: ContractRegistry,
  channelSubscriptions: Map<string, ClientChannelSubscription<ChannelContract>>,
  eventAppliers: Map<string, Set<RegisteredClientEventApplier>>,
  eventListeners: Map<string, Set<ClientEventListener<EventContract>>>,
  reportRuntimeError: (error: ReturnType<typeof createRealtimeError>) => void
): ClientTransportEventReceiver {
  return (event: ClientTransportEvent) => {
    const contract = registry.events.byName[
      event.name as keyof typeof registry.events.byName
    ] as EventContract | undefined;

    if (contract === undefined) {
      return;
    }

    if (
      event.route.channelId !== undefined &&
      !channelSubscriptions.has(event.route.channelId)
    ) {
      reportRuntimeError(
        normalizeClientEventRouteMismatchError(
          contract.name,
          event.route.channelId,
          event.route.target
        )
      );
      return;
    }

    let payload: unknown;

    try {
      payload = parseEventPayload(contract, event.payload);
    } catch (error) {
      if (isRealtimeError(error)) {
        reportRuntimeError(error);
        return;
      }

      throw error;
    }

    const bucket = eventListeners.get(contract.name);
    const applierBucket = eventAppliers.get(contract.name);

    if (applierBucket !== undefined) {
      for (const applier of [...applierBucket]) {
        try {
          applier.apply(payload);
        } catch (error) {
          if (isRealtimeError(error)) {
            reportRuntimeError(error);
            continue;
          }

          reportRuntimeError(
            normalizeClientEventApplierError(error, contract.name)
          );
        }
      }
    }

    if (bucket === undefined) {
      return;
    }

    for (const listener of [...bucket]) {
      try {
        listener(payload as never);
      } catch (error) {
        reportRuntimeError(
          normalizeClientEventListenerError(error, contract.name)
        );
      }
    }
  };
}

/**
 * Разрешает transport result команды и при необходимости накладывает timeout.
 */
function resolveClientCommandResult(
  sendCommand: NonNullable<ClientTransport["sendCommand"]>,
  request: ClientTransportCommandRequest,
  commandName: string,
  timeoutMs: number | undefined,
  signal?: AbortSignal
): Promise<CommandResult> {
  return resolveClientTransportOperation(
    () => sendCommand(request),
    {
      timeoutMs,
      signal,
      createTimeoutError: () =>
        createRealtimeError({
          code: "timeout",
          message: `Command timed out: "${commandName}".`,
          details:
            timeoutMs === undefined
              ? {
                  commandName
                }
              : {
                  commandName,
                  timeoutMs
                }
        }),
      createAbortError: () =>
        createRealtimeError({
          code: "internal-error",
          message: `Client command execution was aborted: "${commandName}".`,
          details: {
            commandName,
            stage: "transport",
            reason: "aborted"
          }
        })
    }
  );
}

/**
 * Нормализует transport-ошибку client command flow в единый realtime error shape.
 */
function normalizeClientCommandTransportFailure(
  error: unknown,
  commandName: string
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "command-failed",
    message: `Client command execution failed at stage "transport": "${commandName}".`,
    details: {
      commandName,
      stage: "transport"
    },
    cause: error
  });
}

/**
 * Разрешает timeout-значение вызова или дефолта runtime и поддерживает
 * явное отключение дедлайна через `false`.
 */
function resolveClientTimeoutMs(
  timeoutMs: number | false | undefined,
  fallbackTimeoutMs: number | undefined,
  label: string
): number | undefined {
  if (timeoutMs === false) {
    return undefined;
  }

  const resolvedTimeoutMs = timeoutMs ?? fallbackTimeoutMs;

  if (resolvedTimeoutMs === undefined) {
    return undefined;
  }

  assertPositiveFiniteTimeout(resolvedTimeoutMs, label);

  return resolvedTimeoutMs;
}

/**
 * Проверяет корректность timeout-параметра runtime-операции.
 */
function assertPositiveFiniteTimeout(timeoutMs: number, label: string): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`${label} must be a positive finite number or false.`);
  }
}

/**
 * Выполняет transport-операцию с единым timeout/abort поведением.
 */
function resolveClientTransportOperation<T>(
  operation: () => T | Promise<T>,
  options: {
    readonly timeoutMs: number | undefined;
    readonly signal: AbortSignal | undefined;
    readonly createTimeoutError: () => ReturnType<typeof createRealtimeError>;
    readonly createAbortError: () => ReturnType<typeof createRealtimeError>;
  }
): Promise<T> {
  const { timeoutMs, signal, createTimeoutError, createAbortError } = options;
  const invokeOperation = (): Promise<T> => {
    try {
      return Promise.resolve(operation());
    } catch (error) {
      return Promise.reject(error);
    }
  };

  if (signal?.aborted === true) {
    return Promise.reject(createAbortError());
  }

  if (timeoutMs === undefined && signal === undefined) {
    return invokeOperation();
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeAbortListener: (() => void) | undefined;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      removeAbortListener?.();
      callback();
    };

    if (timeoutMs !== undefined) {
      timeoutId = setTimeout(() => {
        settle(() => {
          reject(createTimeoutError());
        });
      }, timeoutMs);
    }

    if (signal !== undefined) {
      const abortHandler = () => {
        settle(() => {
          reject(createAbortError());
        });
      };

      signal.addEventListener("abort", abortHandler, {
        once: true
      });
      removeAbortListener = () => {
        signal.removeEventListener("abort", abortHandler);
      };
    }

    const pendingOperation = invokeOperation();

    pendingOperation.then(
      (result) => {
        settle(() => {
          resolve(result);
        });
      },
      (error) => {
        settle(() => {
          reject(error);
        });
      }
    );
  });
}

/**
 * Создает timeout-ошибку channel operation с единым shape.
 */
function createClientChannelOperationTimeoutError(
  channelName: string,
  stage: "subscribe" | "unsubscribe" | "resubscribe",
  timeoutMs: number | undefined
) {
  return createRealtimeError({
    code: "timeout",
    message: `Client channel operation timed out at stage "${stage}": "${channelName}".`,
    details:
      timeoutMs === undefined
        ? {
            channelName,
            stage
          }
        : {
            channelName,
            stage,
            timeoutMs
          }
  });
}

/**
 * Создает abort-ошибку channel operation с единым shape.
 */
function createClientChannelOperationAbortError(
  channelName: string,
  stage: "subscribe" | "unsubscribe" | "resubscribe"
) {
  return createRealtimeError({
    code: "internal-error",
    message: `Client channel operation was aborted at stage "${stage}": "${channelName}".`,
    details: {
      channelName,
      stage,
      reason: "aborted"
    }
  });
}

/**
 * Нормализует transport-ошибку channel subscription flow в общий realtime error.
 */
function normalizeClientChannelOperationFailure(
  error: unknown,
  channelName: string,
  stage: "subscribe" | "unsubscribe" | "resubscribe"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Client channel operation failed at stage "${stage}": "${channelName}".`,
    details: {
      channelName,
      stage
    },
    cause: error
  });
}

/**
 * Нормализует best-effort transport cleanup ошибку channel operation.
 */
function normalizeClientChannelOperationTransportError(
  error: unknown,
  channelName: string,
  stage: "subscribe" | "unsubscribe" | "resubscribe"
) {
  return normalizeClientChannelOperationFailure(error, channelName, stage);
}

/**
 * Нормализует ошибку event applier registration/runtime слоя в общий realtime error.
 */
function normalizeClientEventApplierError(
  error: unknown,
  eventName: string
) {
  return createRealtimeError({
    code: "internal-error",
    message: `Client event applier failed at stage "apply": "${eventName}".`,
    details: {
      eventName,
      stage: "apply"
    },
    cause: error
  });
}

/**
 * Нормализует ошибку user event listener-а в общий realtime error.
 */
function normalizeClientEventListenerError(
  error: unknown,
  eventName: string
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Client event listener failed at stage "listener": "${eventName}".`,
    details: {
      eventName,
      stage: "listener"
    },
    cause: error
  });
}

/**
 * Нормализует ошибку system-event listener-а в общий realtime error.
 */
function normalizeClientSystemEventListenerError(
  error: unknown,
  systemEventName: SystemEventName
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Client system event listener failed at stage "listener": "${systemEventName}".`,
    details: {
      systemEventName,
      stage: "listener"
    },
    cause: error
  });
}

/**
 * Нормализует ошибку connection-state listener-а в общий realtime error.
 */
function normalizeClientConnectionListenerError(
  error: unknown,
  state: ClientConnectionLifecycleState
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Client connection listener failed at state "${state}".`,
    details: {
      state,
      stage: "listener"
    },
    cause: error
  });
}

/**
 * Нормализует stray inbound delivery, которая больше не соответствует
 * локальному channel subscription state клиента.
 */
function normalizeClientEventRouteMismatchError(
  eventName: string,
  channelId: string,
  target: string
) {
  return createRealtimeError({
    code: "internal-error",
    message: `Inbound event delivery does not match an active channel subscription: "${eventName}".`,
    details: {
      eventName,
      channelId,
      target,
      stage: "route"
    }
  });
}

function normalizeClientConnectionLifecycleError(error: unknown) {
  return createRealtimeError({
    code: "internal-error",
    message: "Client connection lifecycle failed at stage \"connect\".",
    details: {
      stage: "connect"
    },
    cause: error
  });
}

function createClientConnectionLifecycleSnapshot(
  state: ClientConnectionLifecycleState,
  previousState: ClientConnectionLifecycleState | undefined,
  transportBound: boolean
): ClientConnectionLifecycleSnapshot {
  const snapshot: ClientConnectionLifecycleSnapshot = {
    state,
    connected: state === "connected",
    transportBound
  };

  if (previousState !== undefined) {
    return Object.freeze({
      ...snapshot,
      previousState
    });
  }

  return Object.freeze(snapshot);
}

function assertClientRuntimeIsActive(
  isDestroyed: boolean,
  action: string
): void {
  if (isDestroyed) {
    throw new TypeError(
      `Client runtime is destroyed and cannot ${action}.`
    );
  }
}

function createUnknownClientContractError(
  kind: "command" | "event" | "channel",
  name: string,
  registeredNames: readonly string[]
): TypeError {
  return new TypeError(
    `Unknown ${kind} contract: "${name}". ${formatRegisteredContractNames(kind, registeredNames)}`
  );
}

function formatRegisteredContractNames(
  kind: "command" | "event" | "channel",
  registeredNames: readonly string[]
): string {
  const label = `${kind}s`;

  if (registeredNames.length === 0) {
    return `Registered ${label}: none.`;
  }

  return `Registered ${label}: ${registeredNames.join(", ")}.`;
}
