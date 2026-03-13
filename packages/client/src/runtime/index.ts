import type {
  ChannelKey,
  ChannelContract,
  CommandAck,
  CommandContract,
  ContractRegistry,
  EventContract,
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
  type ClientRuntimeErrorHandler
} from "../errors/index.ts";
import type {
  ClientChannelSubscription,
} from "../subscriptions/index.ts";
import {
  getClientChannelSubscriptionKey
} from "../subscriptions/index.ts";
import type {
  ClientTransport,
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
    input: ResolveSchemaInput<TRegistry["commands"]["byName"][TName]["input"]>
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
   * Завершает transport binding и освобождает локальные ресурсы runtime.
   */
  destroy(): void;
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
  const channelSubscriptions = new Map<
    string,
    ClientChannelSubscription<ChannelContract>
  >();
  const eventListeners = new Map<
    string,
    Set<ClientEventListener<EventContract>>
  >();
  const transportEventReceiver = createTransportEventReceiver(
    registry,
    eventListeners,
    onError
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
    async executeCommand(name: string, input: unknown) {
      const contract = registry.commands.byName[
        name as keyof typeof registry.commands.byName
      ] as CommandContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown command contract: ${name}.`);
      }

      if (transport?.sendCommand === undefined) {
        throw new TypeError("Client transport does not support command execution.");
      }

      const parsedInput = parseCommandInput(contract, input);
      const request = {
        name: contract.name,
        input: parsedInput
      } satisfies ClientTransportCommandRequest;

      try {
        const rawAck = await transport.sendCommand(request);

        return parseCommandAck(contract, rawAck);
      } catch (error) {
        if (isRealtimeError(error)) {
          throw error;
        }

        throw normalizeClientCommandTransportError(error, name);
      }
    },
    async subscribeChannel(name: string, key: unknown) {
      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown channel contract: ${name}.`);
      }

      if (transport?.subscribeChannel === undefined) {
        throw new TypeError("Client transport does not support channel subscriptions.");
      }

      const instance = createChannelInstance(contract, key);
      const subscriptionKey = getClientChannelSubscriptionKey(name, instance.key);
      const existingSubscription = channelSubscriptions.get(subscriptionKey);

      if (existingSubscription !== undefined) {
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
      const contract = registry.channels.byName[
        name as keyof typeof registry.channels.byName
      ] as ChannelContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown channel contract: ${name}.`);
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
      const contract = registry.events.byName[
        name as keyof typeof registry.events.byName
      ] as EventContract | undefined;

      if (contract === undefined) {
        throw new TypeError(`Unknown event contract: ${name}.`);
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
    destroy() {
      if (isDestroyed) {
        return;
      }

      isDestroyed = true;
      eventListeners.clear();
      channelSubscriptions.clear();
      unbindTransportEvents?.();
      transport?.dispose?.();
    }
  }) as ClientRuntime<TRegistry>;
}

/**
 * Создает базовый receiver transport events.
 * Пока core-runtime только фиксирует binding и lifecycle; дальнейшая
 * маршрутизация появится в event-listener слое.
 */
function createTransportEventReceiver(
  registry: ContractRegistry,
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

    if (bucket === undefined) {
      return;
    }

    for (const listener of [...bucket]) {
      listener(payload as never);
    }
  };
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
 * Нормализует transport-ошибку channel subscription flow в общий realtime error.
 */
function normalizeClientChannelTransportError(
  error: unknown,
  channelName: string,
  stage: "subscribe" | "unsubscribe"
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
