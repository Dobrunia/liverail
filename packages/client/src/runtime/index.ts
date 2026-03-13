import type {
  ChannelKey,
  ChannelContract,
  CommandAck,
  CommandContract,
  CommandResult,
  ContractRegistry,
  EventContract,
  EventPayload,
  ResolveSchemaInput
} from "@liverail/contracts";
import {
  createChannelInstance,
  createRealtimeError,
  isRealtimeError,
  parseCommandAck,
  parseCommandInput,
  parseEventPayload
} from "@liverail/contracts";
import type { ClientEventListener } from "../events/index.ts";
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
  readonly commandTimeoutMs?: number;
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
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>
  ): Promise<ClientChannelSubscription<TRegistry["channels"]["byName"][TName]>>;

  /**
   * Отписывает клиента от typed channel instance.
   */
  unsubscribeChannel<TName extends ChannelName<TRegistry>>(
    name: TName,
    key: ResolveSchemaInput<TRegistry["channels"]["byName"][TName]["key"]>
  ): Promise<boolean>;

  /**
   * Регистрирует typed listener конкретного события и возвращает cleanup.
   */
  onEvent<TName extends EventName<TRegistry>>(
    name: TName,
    listener: ClientEventListener<TRegistry["events"]["byName"][TName]>
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
 * Параметры выполнения typed команды в client runtime.
 */
export interface ExecuteClientCommandOptions {
  /**
   * Необязательный timeout ожидания transport result в миллисекундах.
   */
  readonly timeoutMs?: number;
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
  const defaultCommandTimeoutMs = options.commandTimeoutMs;
  const channelSubscriptions = new Map<
    string,
    ClientChannelSubscription<ChannelContract>
  >();
  const eventAppliers = new Map<string, Set<RegisteredClientEventApplier>>();
  const eventListeners = new Map<
    string,
    Set<ClientEventListener<EventContract>>
  >();
  const transportEventReceiver = createTransportEventReceiver(
    registry,
    eventAppliers,
    eventListeners,
    onError
  );
  const transportConnectionReceiver = createTransportConnectionReceiver(
    channelSubscriptions,
    transport,
    onError
  );
  const unbindTransportConnection = transport?.bindConnection?.(
    transportConnectionReceiver
  );
  const unbindTransportEvents = transport?.bindEvents?.(transportEventReceiver);
  let isDestroyed = false;

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
      const timeoutMs =
        executionOptions.timeoutMs ?? defaultCommandTimeoutMs;

      try {
        const result = await resolveClientCommandResult(
          transport.sendCommand,
          request,
          name,
          timeoutMs
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

          throw normalizeClientCommandTransportError(result.error, name);
        }

        return parseCommandAck(contract, result.ack);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeClientCommandTransportError(error, name);
      }
    },
    async subscribeChannel(name: string, key: unknown) {
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
      const existingSubscription = channelSubscriptions.get(subscriptionKey);

      if (existingSubscription !== undefined) {
        warnClientRuntimeMisuse(
          `Channel subscription is already active: "${name}" with key ${JSON.stringify(instance.key)}.`
        );
        return existingSubscription as ClientChannelSubscription<ChannelContract>;
      }

      const request = {
        name: contract.name,
        key: instance.key
      } satisfies ClientTransportChannelRequest;

      try {
        await transport.subscribeChannel(request);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeClientChannelTransportError(error, name, "subscribe");
      }

      const subscription = Object.freeze({
        contract,
        name: contract.name,
        key: instance.key
      }) as ClientChannelSubscription<ChannelContract>;

      channelSubscriptions.set(subscriptionKey, subscription);

      return subscription;
    },
    async unsubscribeChannel(name: string, key: unknown) {
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

      if (!channelSubscriptions.has(subscriptionKey)) {
        return false;
      }

      if (transport?.unsubscribeChannel === undefined) {
        throw new TypeError("Client transport does not support channel unsubscription.");
      }

      const request = {
        name: contract.name,
        key: instance.key
      } satisfies ClientTransportChannelRequest;

      try {
        await transport.unsubscribeChannel(request);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeClientChannelTransportError(error, name, "unsubscribe");
      }

      channelSubscriptions.delete(subscriptionKey);

      return true;
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
      eventAppliers.clear();
      eventListeners.clear();
      channelSubscriptions.clear();
      unbindTransportConnection?.();
      unbindTransportEvents?.();
      transport?.dispose?.();
    }
  }) as ClientRuntime<TRegistry>;
}

/**
 * Создает receiver lifecycle-событий transport соединения и безопасно
 * восстанавливает активные подписки после reconnect.
 */
function createTransportConnectionReceiver(
  channelSubscriptions: Map<string, ClientChannelSubscription<ChannelContract>>,
  transport: ClientTransport | undefined,
  onError: ClientRuntimeErrorHandler | undefined
): ClientTransportConnectionReceiver {
  let shouldResubscribe = false;

  return (event: ClientTransportConnectionEvent) => {
    if (event.status === "disconnected") {
      shouldResubscribe = true;
      return;
    }

    if (!shouldResubscribe) {
      return;
    }

    shouldResubscribe = false;

    if (transport?.subscribeChannel === undefined) {
      return;
    }

    for (const subscription of [...channelSubscriptions.values()]) {
      const request = {
        name: subscription.name,
        key: subscription.key
      } satisfies ClientTransportChannelRequest;

      void Promise.resolve(transport.subscribeChannel(request)).catch(
        (error: unknown) => {
        if (isRealtimeError(error)) {
          reportClientRuntimeError(error, onError);
          return;
        }

        reportClientRuntimeError(
          normalizeClientChannelTransportError(
            error,
            subscription.name,
            "resubscribe"
          ),
          onError
        );
        }
      );
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
  eventAppliers: Map<string, Set<RegisteredClientEventApplier>>,
  eventListeners: Map<string, Set<ClientEventListener<EventContract>>>,
  onError: ClientRuntimeErrorHandler | undefined
): ClientTransportEventReceiver {
  return (event: ClientTransportEvent) => {
    const contract = registry.events.byName[
      event.name as keyof typeof registry.events.byName
    ] as EventContract | undefined;

    if (contract === undefined) {
      return;
    }

    let payload: unknown;

    try {
      payload = parseEventPayload(contract, event.payload);
    } catch (error) {
      if (isRealtimeError(error)) {
        reportClientRuntimeError(error, onError);
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
            reportClientRuntimeError(error, onError);
            continue;
          }

          reportClientRuntimeError(
            normalizeClientEventApplierError(error, contract.name),
            onError
          );
        }
      }
    }

    if (bucket === undefined) {
      return;
    }

    for (const listener of [...bucket]) {
      listener(payload as never);
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
  timeoutMs: number | undefined
): Promise<CommandResult> {
  const pendingResult = Promise.resolve(sendCommand(request));

  if (timeoutMs === undefined) {
    return pendingResult;
  }

  assertClientCommandTimeout(timeoutMs);

  return new Promise<CommandResult>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        createRealtimeError({
          code: "timeout",
          message: `Command timed out: "${commandName}".`,
          details: {
            commandName,
            timeoutMs
          }
        })
      );
    }, timeoutMs);

    pendingResult.then(
      (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

/**
 * Нормализует transport-ошибку client command flow в единый realtime error shape.
 */
function normalizeClientCommandTransportError(
  error: unknown,
  commandName: string
) {
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
 * Проверяет корректность timeout-параметра command execution.
 */
function assertClientCommandTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Client command timeout must be a positive finite number.");
  }
}

/**
 * Нормализует transport-ошибку channel subscription flow в общий realtime error.
 */
function normalizeClientChannelTransportError(
  error: unknown,
  channelName: string,
  stage: "subscribe" | "unsubscribe" | "resubscribe"
) {
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
