import {
  createChannelInstance,
  createRealtimeError,
  isRealtimeError,
  stringifyChannelInstance,
  type ContractMetadata,
  type CommandResult,
  type ContractRegistry,
  type RealtimeErrorPayload
} from "@liverail/contracts";
import type { Server as SocketIoServer, Socket as SocketIoSocket } from "socket.io";

import type {
  ServerEventDeliverer,
  ServerEventRoute,
  ServerRuntime
} from "../runtime/index.ts";
import { SERVER_RUNTIME_LIFECYCLE_BRIDGE } from "../runtime/index.ts";
import {
  createServerRuntimeContext,
  type ServerRuntimeContextInit
} from "../context/index.ts";

type MaybePromise<T> = T | Promise<T>;

const SOCKET_IO_CHANNEL_ROOM_PREFIX = "liverail:channel:";
const SOCKET_IO_SOCKET_ROUTE_TARGET = "socket";
const SOCKET_IO_CHANNEL_ROUTE_TARGET = "channel";
const SOCKET_IO_OPERATION_SUCCESS = Object.freeze({
  ok: true as const
});

/**
 * Официальное Socket.IO event name для transport-level command dispatch.
 */
export const SOCKET_IO_COMMAND_EVENT = "liverail:command";

/**
 * Официальное Socket.IO event name для transport-level join запроса.
 */
export const SOCKET_IO_CHANNEL_JOIN_EVENT = "liverail:channel:join";

/**
 * Официальное Socket.IO event name для transport-level leave запроса.
 */
export const SOCKET_IO_CHANNEL_LEAVE_EVENT = "liverail:channel:leave";

/**
 * Transport-level request shape для выполнения команды через Socket.IO.
 */
export interface SocketIoCommandRequest {
  /**
   * Имя команды в transport-friendly виде.
   */
  readonly name: string;

  /**
   * Сырой payload команды, который дальше валидирует server runtime.
   */
  readonly input: unknown;
}

/**
 * Transport-level request shape для join/leave операций канала.
 */
export interface SocketIoChannelRequest {
  /**
   * Имя channel template.
   */
  readonly name: string;

  /**
   * Сырой channel key конкретного instance.
   */
  readonly key: unknown;
}

/**
 * Успешный transport-level результат channel операции.
 */
export interface SocketIoOperationSuccess {
  /**
   * Флаг успешного завершения операции.
   */
  readonly ok: true;
}

/**
 * Ошибочный transport-level результат channel операции.
 */
export interface SocketIoOperationFailure {
  /**
   * Флаг неуспешного завершения transport операции.
   */
  readonly ok: false;

  /**
   * Сериализованная realtime-ошибка для передачи через Socket.IO ack.
   */
  readonly error: RealtimeErrorPayload;
}

/**
 * Полная transport-level result model для join/leave через Socket.IO.
 */
export type SocketIoOperationResult =
  | SocketIoOperationSuccess
  | SocketIoOperationFailure;

/**
 * Функция построения runtime context из конкретного Socket.IO socket.
 */
export type SocketIoConnectionContextResolver<TRuntimeContext = unknown> = (
  socket: SocketIoSocket
) => MaybePromise<TRuntimeContext>;

/**
 * Transport-level input для сборки официального unified runtime context.
 */
export type SocketIoConnectionContextInjector<
  TSession = unknown,
  TUser = unknown,
  TMetadata = ContractMetadata
> = (
  socket: SocketIoSocket
) => MaybePromise<ServerRuntimeContextInit<TSession, TUser, TMetadata>>;

/**
 * Параметры создания thin Socket.IO adapter поверх server runtime.
 */
export interface CreateSocketIoServerAdapterOptions<
  TRuntimeContext = unknown,
  TRegistry extends ContractRegistry = ContractRegistry
> {
  /**
   * Реальный Socket.IO server instance.
   */
  readonly io: SocketIoServer;

  /**
   * Уже созданный transport-agnostic server runtime.
   */
  readonly runtime: ServerRuntime<TRuntimeContext, TRegistry>;

  /**
   * Строит runtime context из handshake/socket-данных.
   */
  readonly resolveContext?: SocketIoConnectionContextResolver<TRuntimeContext>;

  /**
   * Строит unified runtime context через session/user/metadata injection.
   */
  readonly injectContext?: SocketIoConnectionContextInjector;

  /**
   * Необязательное имя command event вместо дефолтного.
   */
  readonly commandEvent?: string;

  /**
   * Необязательное имя channel join event вместо дефолтного.
   */
  readonly joinEvent?: string;

  /**
   * Необязательное имя channel leave event вместо дефолтного.
   */
  readonly leaveEvent?: string;
}

/**
 * Публичный handle созданного Socket.IO adapter.
 */
export interface SocketIoServerAdapter {
  /**
   * Используемое event name для command dispatch.
   */
  readonly commandEvent: string;

  /**
   * Используемое event name для channel join.
   */
  readonly joinEvent: string;

  /**
   * Используемое event name для channel leave.
   */
  readonly leaveEvent: string;

  /**
   * Снимает transport listeners и освобождает локальное состояние adapter-а.
   */
  readonly dispose: () => void;
}

/**
 * Создает thin Socket.IO adapter, который связывает transport events с runtime.
 */
export function createSocketIoServerAdapter<
  TRuntimeContext = unknown,
  TRegistry extends ContractRegistry = ContractRegistry
>(
  options: CreateSocketIoServerAdapterOptions<TRuntimeContext, TRegistry>
): SocketIoServerAdapter {
  if (options?.io === undefined) {
    throw new TypeError("Socket.IO server adapter requires a server instance.");
  }

  if (options.runtime === undefined) {
    throw new TypeError("Socket.IO server adapter requires a server runtime.");
  }

  if (
    typeof options.resolveContext !== "function" &&
    typeof options.injectContext !== "function"
  ) {
    throw new TypeError(
      "Socket.IO server adapter requires a context resolver or injector."
    );
  }

  const commandEvent = options.commandEvent ?? SOCKET_IO_COMMAND_EVENT;
  const joinEvent = options.joinEvent ?? SOCKET_IO_CHANNEL_JOIN_EVENT;
  const leaveEvent = options.leaveEvent ?? SOCKET_IO_CHANNEL_LEAVE_EVENT;
  const contextBySocketId = new Map<string, TRuntimeContext>();
  const joinedChannelsBySocketId = new Map<
    string,
    Map<string, SocketIoChannelRequest>
  >();
  const disconnectHandlersBySocketId = new Map<string, () => void>();
  const namespace = options.io.of("/");
  let isDisposed = false;

  const resolveSocketContext = async (
    socket: SocketIoSocket
  ): Promise<TRuntimeContext> => {
    if (contextBySocketId.has(socket.id)) {
      return contextBySocketId.get(socket.id) as TRuntimeContext;
    }

    let context: TRuntimeContext;

    if (typeof options.injectContext === "function") {
      const injectedContext = await options.injectContext(socket);

      context = createServerRuntimeContext({
        connectionId: socket.id,
        transport: "socket.io",
        session: injectedContext.session,
        user: injectedContext.user,
        metadata: injectedContext.metadata
      }) as TRuntimeContext;
    } else {
      context = await options.resolveContext!(socket);
    }

    contextBySocketId.set(socket.id, context);

    return context;
  };
  const connectionMiddleware = (
    socket: SocketIoSocket,
    next: (error?: Error) => void
  ) => {
    if (isDisposed) {
      next(createSocketIoConnectError(
        createRealtimeError({
          code: "internal-error",
          message: "Socket.IO server adapter is disposed."
        }).toJSON()
      ));
      return;
    }

    void resolveSocketContext(socket)
      .then((context) => options.runtime.authorizeConnection({
        context
      }))
      .then(() => {
        next();
      })
      .catch((error: unknown) => {
        next(createSocketIoConnectError(
          normalizeSocketIoConnectionError(error).toJSON()
        ));
      });
  };
  const connectionHandler = (socket: SocketIoSocket) => {
    if (isDisposed) {
      socket.disconnect(true);
      return;
    }

    void resolveSocketContext(socket)
      .then(async (context) => {
        await notifySocketIoRuntimeConnected(options.runtime, {
          connectionId: socket.id,
          context
        });

        socket.on(commandEvent, (request, acknowledge) => {
          void handleSocketIoCommandRequest(
            socket,
            request,
            acknowledge,
            options.runtime,
            resolveSocketContext
          );
        });
        socket.on(joinEvent, (request, acknowledge) => {
          void handleSocketIoChannelRequest(
            socket,
            request,
            acknowledge,
            "join",
            options.runtime,
            resolveSocketContext,
            joinedChannelsBySocketId
          );
        });
        socket.on(leaveEvent, (request, acknowledge) => {
          void handleSocketIoChannelRequest(
            socket,
            request,
            acknowledge,
            "leave",
            options.runtime,
            resolveSocketContext,
            joinedChannelsBySocketId
          );
        });
        const disconnectHandler = () => {
          disconnectHandlersBySocketId.delete(socket.id);
          void cleanupSocketIoConnection(
            socket.id,
            contextBySocketId,
            joinedChannelsBySocketId,
            options.runtime
          );
        };

        disconnectHandlersBySocketId.set(socket.id, disconnectHandler);
        socket.on("disconnect", disconnectHandler);
      })
      .catch(() => {
        contextBySocketId.delete(socket.id);
        socket.disconnect(true);
      });
  };

  namespace.use(connectionMiddleware);
  namespace.on("connection", connectionHandler);

  return Object.freeze({
    commandEvent,
    joinEvent,
    leaveEvent,
    dispose() {
      if (isDisposed) {
        return;
      }

      isDisposed = true;
      namespace.off("connection", connectionHandler);

      for (const socket of namespace.sockets.values()) {
        const disconnectHandler = disconnectHandlersBySocketId.get(socket.id);

        if (disconnectHandler !== undefined) {
          socket.off("disconnect", disconnectHandler);
          disconnectHandlersBySocketId.delete(socket.id);
          void cleanupSocketIoConnection(
            socket.id,
            contextBySocketId,
            joinedChannelsBySocketId,
            options.runtime
          );
        }

        socket.removeAllListeners(commandEvent);
        socket.removeAllListeners(joinEvent);
        socket.removeAllListeners(leaveEvent);
        socket.disconnect(true);
      }

      if (namespace.sockets.size === 0) {
        contextBySocketId.clear();
        joinedChannelsBySocketId.clear();
      }
    }
  });
}

/**
 * Создает route для доставки события в конкретный Socket.IO socket.
 */
export function createSocketIoSocketRoute(socketId: string): ServerEventRoute {
  assertNonEmptyString(socketId, "Socket.IO socket id");

  return Object.freeze({
    target: SOCKET_IO_SOCKET_ROUTE_TARGET,
    metadata: Object.freeze({
      socketId
    })
  });
}

/**
 * Создает route для доставки события в конкретную Socket.IO room канала.
 */
export function createSocketIoChannelRoute(
  channelName: string,
  key: unknown
): ServerEventRoute {
  const channelId = stringifyChannelInstance(channelName, key);

  return Object.freeze({
    target: SOCKET_IO_CHANNEL_ROUTE_TARGET,
    metadata: Object.freeze({
      roomId: getSocketIoChannelRoom(channelName, key),
      channelId
    })
  });
}

/**
 * Возвращает детерминированное Socket.IO room name для channel instance.
 */
export function getSocketIoChannelRoom(
  channelName: string,
  key: unknown
): string {
  assertNonEmptyString(channelName, "Socket.IO channel name");

  return `${SOCKET_IO_CHANNEL_ROOM_PREFIX}${stringifyChannelInstance(channelName, key)}`;
}

/**
 * Создает transport deliverer для уже построенных Socket.IO routes.
 */
export function createSocketIoEventDeliverer(
  io: SocketIoServer
): ServerEventDeliverer {
  if (io === undefined) {
    throw new TypeError("Socket.IO event deliverer requires a server instance.");
  }

  return async (delivery) => {
    const roomId = readSocketIoRouteRoomId(delivery.route);

    io.to(roomId).emit(
      delivery.name,
      delivery.payload,
      createSocketIoTransportEventRoute(delivery.route)
    );
  };
}

/**
 * Выполняет transport binding команды и возвращает transport-friendly result.
 */
async function handleSocketIoCommandRequest<TRuntimeContext>(
  socket: SocketIoSocket,
  request: unknown,
  acknowledge: unknown,
  runtime: ServerRuntime<TRuntimeContext>,
  resolveSocketContext: (socket: SocketIoSocket) => Promise<TRuntimeContext>
): Promise<void> {
  if (typeof acknowledge !== "function") {
    return;
  }

  try {
    const context = await resolveSocketContext(socket);
    const commandRequest = readSocketIoCommandRequest(request);
    const ack = await runtime.executeCommand(
      commandRequest.name,
      commandRequest.input,
      {
        context
      }
    );
    const result = Object.freeze({
      status: "ack",
      ack
    }) satisfies CommandResult;

    acknowledge(result);
  } catch (error) {
    acknowledge({
      status: "error",
      error: normalizeSocketIoCommandError(error, request).toJSON()
    } satisfies CommandResult);
  }
}

/**
 * Выполняет Socket.IO join/leave binding через существующий channel runtime.
 */
async function handleSocketIoChannelRequest<TRuntimeContext>(
  socket: SocketIoSocket,
  request: unknown,
  acknowledge: unknown,
  stage: "join" | "leave",
  runtime: ServerRuntime<TRuntimeContext>,
  resolveSocketContext: (socket: SocketIoSocket) => Promise<TRuntimeContext>,
  joinedChannelsBySocketId: Map<string, Map<string, SocketIoChannelRequest>>
): Promise<void> {
  if (typeof acknowledge !== "function") {
    return;
  }

  try {
    const channelRequest = readSocketIoChannelRequest(request);

    if (stage === "join") {
      const context = await resolveSocketContext(socket);
      const membership = await runtime.joinChannel(
        channelRequest.name,
        channelRequest.key,
        {
          memberId: socket.id,
          context
        }
      );
      const joinedChannel = {
        name: membership.name,
        key: membership.key
      } satisfies SocketIoChannelRequest;
      const roomId = getSocketIoChannelRoom(
        joinedChannel.name,
        joinedChannel.key
      );

      try {
        await socket.join(roomId);
      } catch (error) {
        try {
          await runtime.leaveChannel(
            joinedChannel.name,
            joinedChannel.key,
            {
              memberId: socket.id
            }
          );
        } catch {
          // Rollback stays best-effort, but adapter must still surface the
          // original transport binding error instead of masking it.
        }

        throw error;
      }

      rememberJoinedSocketIoChannel(
        joinedChannelsBySocketId,
        socket.id,
        joinedChannel
      );
    } else {
      const channelContract = runtime.resolveChannel(channelRequest.name);

      if (channelContract === undefined) {
        throw new TypeError(
          `Unknown channel contract: "${channelRequest.name}".`
        );
      }

      const instance = createChannelInstance(channelContract, channelRequest.key);
      const leftChannel = {
        name: instance.name,
        key: instance.key
      } satisfies SocketIoChannelRequest;
      let leftTransportChannel = false;

      try {
        await socket.leave(
          getSocketIoChannelRoom(leftChannel.name, leftChannel.key)
        );
        leftTransportChannel = true;
        await runtime.leaveChannel(
          leftChannel.name,
          leftChannel.key,
          {
            memberId: socket.id
          }
        );
      } catch (error) {
        if (leftTransportChannel) {
          forgetJoinedSocketIoChannel(
            joinedChannelsBySocketId,
            socket.id,
            leftChannel
          );
        }

        throw error;
      }

      forgetJoinedSocketIoChannel(
        joinedChannelsBySocketId,
        socket.id,
        leftChannel
      );
    }

    acknowledge(SOCKET_IO_OPERATION_SUCCESS);
  } catch (error) {
    acknowledge({
      ok: false,
      error: normalizeSocketIoChannelError(error, request, stage).toJSON()
    } satisfies SocketIoOperationResult);
  }
}

/**
 * Запоминает channel membership конкретного socket для cleanup на disconnect.
 */
function rememberJoinedSocketIoChannel(
  joinedChannelsBySocketId: Map<string, Map<string, SocketIoChannelRequest>>,
  socketId: string,
  request: SocketIoChannelRequest
): void {
  let bucket = joinedChannelsBySocketId.get(socketId);

  if (bucket === undefined) {
    bucket = new Map();
    joinedChannelsBySocketId.set(socketId, bucket);
  }

  bucket.set(getSocketIoChannelRoom(request.name, request.key), request);
}

/**
 * Удаляет конкретную channel membership из disconnect cleanup bucket-а.
 */
function forgetJoinedSocketIoChannel(
  joinedChannelsBySocketId: Map<string, Map<string, SocketIoChannelRequest>>,
  socketId: string,
  request: SocketIoChannelRequest
): void {
  const bucket = joinedChannelsBySocketId.get(socketId);

  if (bucket === undefined) {
    return;
  }

  bucket.delete(getSocketIoChannelRoom(request.name, request.key));

  if (bucket.size === 0) {
    joinedChannelsBySocketId.delete(socketId);
  }
}

/**
 * Снимает все runtime memberships socket-а после transport disconnect.
 */
async function removeSocketIoChannelMemberships<TRuntimeContext>(
  socketId: string,
  joinedChannelsBySocketId: Map<string, Map<string, SocketIoChannelRequest>>,
  runtime: ServerRuntime<TRuntimeContext>
): Promise<void> {
  const bucket = joinedChannelsBySocketId.get(socketId);

  if (bucket === undefined) {
    return;
  }

  joinedChannelsBySocketId.delete(socketId);

  for (const request of bucket.values()) {
    try {
      await runtime.leaveChannel(
        request.name,
        request.key,
        {
          memberId: socketId
        }
      );
    } catch {
      // Disconnect cleanup must continue freeing the remaining memberships
      // even if one leave hook or runtime path fails.
    }
  }
}

async function cleanupSocketIoConnection<TRuntimeContext>(
  socketId: string,
  contextBySocketId: Map<string, TRuntimeContext>,
  joinedChannelsBySocketId: Map<string, Map<string, SocketIoChannelRequest>>,
  runtime: ServerRuntime<TRuntimeContext>
): Promise<void> {
  const connectionContext = contextBySocketId.get(socketId);

  try {
    await removeSocketIoChannelMemberships(
      socketId,
      joinedChannelsBySocketId,
      runtime
    );
  } catch {
    // Cleanup path stays best-effort and must not break adapter teardown.
  }

  try {
    if (connectionContext !== undefined) {
      await notifySocketIoRuntimeDisconnected(runtime, {
        connectionId: socketId,
        context: connectionContext
      });
    }
  } catch {
    // Disconnect cleanup also remains best-effort during teardown.
  } finally {
    contextBySocketId.delete(socketId);
  }
}

/**
 * Превращает transport connect failure в стандартный Socket.IO connect_error.
 */
function createSocketIoConnectError(payload: RealtimeErrorPayload): Error & {
  readonly data: RealtimeErrorPayload;
} {
  const error = new Error(payload.message) as Error & {
    data: RealtimeErrorPayload;
  };

  error.data = payload;

  return error;
}

/**
 * Нормализует сбой connection authorization в существующий realtime error.
 */
function normalizeSocketIoConnectionError(error: unknown) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: "Socket.IO connection authorization failed.",
    cause: error
  });
}

/**
 * Нормализует transport-level сбой команды без расширения общего error model.
 */
function normalizeSocketIoCommandError(
  error: unknown,
  request: unknown
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "command-failed",
    message: `Socket.IO command execution failed: "${readRequestName(request, "command")}".`,
    details: {
      stage: "transport"
    },
    cause: error
  });
}

/**
 * Нормализует transport-level сбой join/leave операции в общий error shape.
 */
function normalizeSocketIoChannelError(
  error: unknown,
  request: unknown,
  stage: "join" | "leave"
) {
  if (isRealtimeError(error)) {
    return error;
  }

  return createRealtimeError({
    code: "internal-error",
    message: `Socket.IO channel operation failed at stage "${stage}": "${readRequestName(request, "channel")}".`,
    details: {
      stage
    },
    cause: error
  });
}

function readSocketIoCommandRequest(
  request: unknown
): SocketIoCommandRequest {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof (request as { name?: unknown }).name !== "string"
  ) {
    throw new TypeError("Socket.IO command request must include a command name.");
  }

  return request as SocketIoCommandRequest;
}

function readSocketIoChannelRequest(
  request: unknown
): SocketIoChannelRequest {
  if (
    typeof request !== "object" ||
    request === null ||
    typeof (request as { name?: unknown }).name !== "string"
  ) {
    throw new TypeError("Socket.IO channel request must include a channel name.");
  }

  return request as SocketIoChannelRequest;
}

function readSocketIoRouteRoomId(route: ServerEventRoute): string {
  if (route.target === SOCKET_IO_SOCKET_ROUTE_TARGET) {
    const socketId = route.metadata?.socketId;

    if (typeof socketId !== "string" || socketId.length === 0) {
      throw new TypeError("Socket.IO socket routes require a non-empty socketId.");
    }

    return socketId;
  }

  if (route.target === SOCKET_IO_CHANNEL_ROUTE_TARGET) {
    const roomId = route.metadata?.roomId;

    if (typeof roomId !== "string" || roomId.length === 0) {
      throw new TypeError("Socket.IO channel routes require a non-empty roomId.");
    }

    return roomId;
  }

  throw new TypeError(`Unsupported Socket.IO route target: ${route.target}.`);
}

/**
 * Преобразует server route в transport route payload для клиентского runtime.
 */
function createSocketIoTransportEventRoute(route: ServerEventRoute): {
  readonly target: string;
  readonly channelId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  if (route.target === SOCKET_IO_CHANNEL_ROUTE_TARGET) {
    const channelId = route.metadata?.channelId;

    if (typeof channelId !== "string" || channelId.length === 0) {
      throw new TypeError("Socket.IO channel routes require a non-empty channelId.");
    }

    if (route.metadata !== undefined) {
      return Object.freeze({
        target: route.target,
        channelId,
        metadata: route.metadata
      });
    }

    return Object.freeze({
      target: route.target,
      channelId
    });
  }

  if (route.metadata !== undefined) {
    return Object.freeze({
      target: route.target,
      metadata: route.metadata
    });
  }

  return Object.freeze({
    target: route.target
  });
}

function readRequestName(
  request: unknown,
  fallback: "command" | "channel"
): string {
  if (
    typeof request === "object" &&
    request !== null &&
    typeof (request as { name?: unknown }).name === "string"
  ) {
    return (request as { name: string }).name;
  }

  return fallback;
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

async function notifySocketIoRuntimeConnected<TRuntimeContext>(
  runtime: ServerRuntime<TRuntimeContext>,
  connection: {
    readonly connectionId: string;
    readonly context: TRuntimeContext;
  }
): Promise<void> {
  const bridge = readServerRuntimeLifecycleBridge(runtime);

  if (bridge === undefined) {
    return;
  }

  await bridge.notifyConnected(connection);
}

async function notifySocketIoRuntimeDisconnected<TRuntimeContext>(
  runtime: ServerRuntime<TRuntimeContext>,
  connection: {
    readonly connectionId: string;
    readonly context: TRuntimeContext;
  }
): Promise<void> {
  const bridge = readServerRuntimeLifecycleBridge(runtime);

  if (bridge === undefined) {
    return;
  }

  await bridge.notifyDisconnected(connection);
}

function readServerRuntimeLifecycleBridge<TRuntimeContext>(
  runtime: ServerRuntime<TRuntimeContext>
):
  | {
      readonly notifyConnected: (connection: {
        readonly connectionId: string;
        readonly context: TRuntimeContext;
      }) => Promise<void>;
      readonly notifyDisconnected: (connection: {
        readonly connectionId: string;
        readonly context: TRuntimeContext;
      }) => Promise<void>;
    }
  | undefined {
  const runtimeWithBridge = runtime as ServerRuntime<TRuntimeContext> & {
    readonly [SERVER_RUNTIME_LIFECYCLE_BRIDGE]?: {
      readonly notifyConnected: (connection: {
        readonly connectionId: string;
        readonly context: TRuntimeContext;
      }) => Promise<void>;
      readonly notifyDisconnected: (connection: {
        readonly connectionId: string;
        readonly context: TRuntimeContext;
      }) => Promise<void>;
    };
  };

  return runtimeWithBridge[SERVER_RUNTIME_LIFECYCLE_BRIDGE];
}
