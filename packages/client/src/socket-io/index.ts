import {
  createRealtimeError,
  type CommandResult,
  type RealtimeErrorPayload
} from "@dobrunia-liverail/contracts";
import {
  io as createSocketIoClient,
  type Socket as SocketIoClientSocket
} from "socket.io-client";

import type {
  ClientTransport,
  ClientTransportChannelRequest,
  ClientTransportCommandRequest,
  ClientTransportConnectionReceiver,
  ClientTransportEventReceiver
} from "../transport/index.ts";

/**
 * Официальное Socket.IO event name для transport-level command dispatch.
 */
export const SOCKET_IO_COMMAND_EVENT = "liverail:command";

/**
 * Официальное Socket.IO event name для transport-level channel join.
 */
export const SOCKET_IO_CHANNEL_JOIN_EVENT = "liverail:channel:join";

/**
 * Официальное Socket.IO event name для transport-level channel leave.
 */
export const SOCKET_IO_CHANNEL_LEAVE_EVENT = "liverail:channel:leave";

/**
 * Общие Socket.IO client options для happy path, где transport сам создает socket.
 */
export type SocketIoClientConnectionOptions = NonNullable<
  Parameters<typeof createSocketIoClient>[1]
>;

interface CreateSocketIoClientTransportFromSocketOptions {
  /**
   * Реальный Socket.IO client socket.
   */
  readonly socket: SocketIoClientSocket;

  /**
   * `url` нельзя передавать одновременно с готовым socket.
   */
  readonly url?: never;

  /**
   * Настройки клиента доступны только в режиме создания socket по `url`.
   */
  readonly socketOptions?: never;

  /**
   * Необязательное имя command event вместо дефолтного.
   */
  readonly commandEvent?: string;

  /**
   * Необязательное имя join event вместо дефолтного.
   */
  readonly joinEvent?: string;

  /**
   * Необязательное имя leave event вместо дефолтного.
   */
  readonly leaveEvent?: string;

  /**
   * Нужно ли разрывать socket при `dispose`.
   */
  readonly disconnectOnDispose?: boolean;
}

interface CreateSocketIoClientTransportFromUrlOptions {
  /**
   * URL, по которому transport сам создаст внутренний Socket.IO client.
   */
  readonly url: string;

  /**
   * Готовый socket нельзя передавать одновременно с `url`.
   */
  readonly socket?: never;

  /**
   * Необязательные настройки Socket.IO client для happy path.
   */
  readonly socketOptions?: SocketIoClientConnectionOptions;

  /**
   * Необязательное имя command event вместо дефолтного.
   */
  readonly commandEvent?: string;

  /**
   * Необязательное имя join event вместо дефолтного.
   */
  readonly joinEvent?: string;

  /**
   * Необязательное имя leave event вместо дефолтного.
   */
  readonly leaveEvent?: string;

  /**
   * Нужно ли разрывать socket при `dispose`.
   * Для internal socket по умолчанию включено.
   */
  readonly disconnectOnDispose?: boolean;
}

/**
 * Параметры создания Socket.IO client transport adapter.
 */
export type CreateSocketIoClientTransportOptions =
  | CreateSocketIoClientTransportFromSocketOptions
  | CreateSocketIoClientTransportFromUrlOptions;

/**
 * Реальный Socket.IO transport adapter для client runtime.
 */
export interface SocketIoClientTransport extends ClientTransport {
  /**
   * Текущее event name для command dispatch.
   */
  readonly commandEvent: string;

  /**
   * Текущее event name для channel join.
   */
  readonly joinEvent: string;

  /**
   * Текущее event name для channel leave.
   */
  readonly leaveEvent: string;
}

/**
 * Создает Socket.IO transport adapter, совместимый с client runtime.
 */
export function createSocketIoClientTransport(
  options: CreateSocketIoClientTransportOptions
): SocketIoClientTransport {
  if (options === undefined) {
    throw new TypeError(
      "Socket.IO client transport requires either a socket instance or a connection url."
    );
  }

  const socket = resolveSocketIoClientSocket(options);
  const ownsSocket = isSocketIoUrlTransportOptions(options);
  const commandEvent = options.commandEvent ?? SOCKET_IO_COMMAND_EVENT;
  const joinEvent = options.joinEvent ?? SOCKET_IO_CHANNEL_JOIN_EVENT;
  const leaveEvent = options.leaveEvent ?? SOCKET_IO_CHANNEL_LEAVE_EVENT;
  const disconnectOnDispose = options.disconnectOnDispose ?? ownsSocket;

  return Object.freeze({
    commandEvent,
    joinEvent,
    leaveEvent,
    sendCommand(request: ClientTransportCommandRequest) {
      return emitSocketIoCommand(socket, commandEvent, request);
    },
    subscribeChannel(request: ClientTransportChannelRequest) {
      return emitSocketIoChannelOperation(
        socket,
        joinEvent,
        request,
        "subscribe"
      );
    },
    unsubscribeChannel(request: ClientTransportChannelRequest) {
      return emitSocketIoChannelOperation(
        socket,
        leaveEvent,
        request,
        "unsubscribe"
      );
    },
    bindConnection(receiver: ClientTransportConnectionReceiver) {
      return bindSocketIoConnectionLifecycle(socket, receiver);
    },
    bindEvents(receiver: ClientTransportEventReceiver) {
      return bindSocketIoEvents(
        socket,
        receiver,
        commandEvent,
        joinEvent,
        leaveEvent
      );
    },
    dispose() {
      if (disconnectOnDispose) {
        socket.disconnect();
      }
    }
  });
}

/**
 * Возвращает готовый Socket.IO client socket из явного socket или создает
 * его по `url` для минимального happy path.
 */
function resolveSocketIoClientSocket(
  options: CreateSocketIoClientTransportOptions
): SocketIoClientSocket {
  if (isSocketIoSocketTransportOptions(options)) {
    return options.socket;
  }

  if (isSocketIoUrlTransportOptions(options)) {
    return createSocketIoClient(options.url, options.socketOptions);
  }

  throw new TypeError(
    "Socket.IO client transport requires either a socket instance or a connection url."
  );
}

/**
 * Привязывает Socket.IO lifecycle к общей connection model клиентского runtime.
 */
function bindSocketIoConnectionLifecycle(
  socket: SocketIoClientSocket,
  receiver: ClientTransportConnectionReceiver
): () => void {
  const onConnecting = () => {
    receiver({
      status: "connecting"
    });
  };
  const onConnect = () => {
    receiver({
      status: "connected"
    });
  };
  const onReconnectAttempt = () => {
    receiver({
      status: "reconnecting"
    });
  };
  const onDisconnect = () => {
    receiver({
      status: "disconnected"
    });
  };
  const onConnectError = (error: unknown) => {
    receiver({
      status: "failed",
      error
    });
  };

  socket.on("connect", onConnect);
  socket.on("reconnect_attempt", onReconnectAttempt);
  socket.on("disconnect", onDisconnect);
  socket.on("connect_error", onConnectError);

  if (socket.connected) {
    onConnect();
  } else {
    onConnecting();
  }

  return () => {
    socket.off("connect", onConnect);
    socket.off("reconnect_attempt", onReconnectAttempt);
    socket.off("disconnect", onDisconnect);
    socket.off("connect_error", onConnectError);
  };
}

/**
 * Привязывает inbound Socket.IO events к transport-agnostic event receiver.
 */
function bindSocketIoEvents(
  socket: SocketIoClientSocket,
  receiver: ClientTransportEventReceiver,
  commandEvent: string,
  joinEvent: string,
  leaveEvent: string
): () => void {
  const onAny = (
    eventName: string,
    payload: unknown,
    route: unknown
  ) => {
    if (
      eventName === commandEvent ||
      eventName === joinEvent ||
      eventName === leaveEvent
    ) {
      return;
    }

    receiver({
      name: eventName,
      payload,
      route: readSocketIoClientEventRoute(route)
    });
  };

  socket.onAny(onAny);

  return () => {
    socket.offAny(onAny);
  };
}

/**
 * Нормализует transport route входящего Socket.IO события в общий client shape.
 */
function readSocketIoClientEventRoute(route: unknown): {
  readonly target: string;
  readonly channelId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  if (
    typeof route === "object" &&
    route !== null &&
    typeof (route as { target?: unknown }).target === "string"
  ) {
    const normalizedRoute = {
      target: (route as { target: string }).target
    } as {
      readonly target: string;
      readonly channelId?: string;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };

    if (typeof (route as { channelId?: unknown }).channelId === "string") {
      const channelId = (route as { channelId: string }).channelId;

      if (
        typeof (route as { metadata?: unknown }).metadata === "object" &&
        (route as { metadata?: unknown }).metadata !== null
      ) {
        return Object.freeze({
          ...normalizedRoute,
          channelId,
          metadata: Object.freeze({
            ...((route as {
              metadata: Readonly<Record<string, unknown>>;
            }).metadata)
          })
        });
      }

      return Object.freeze({
        ...normalizedRoute,
        channelId
      });
    }

    if (
      typeof (route as { metadata?: unknown }).metadata === "object" &&
      (route as { metadata?: unknown }).metadata !== null
    ) {
      return Object.freeze({
        ...normalizedRoute,
        metadata: Object.freeze({
          ...((route as {
            metadata: Readonly<Record<string, unknown>>;
          }).metadata)
        })
      });
    }

    return Object.freeze(normalizedRoute);
  }

  return Object.freeze({
    target: "direct"
  });
}

/**
 * Выполняет transport-level command dispatch через Socket.IO ack callback.
 */
function emitSocketIoCommand(
  socket: SocketIoClientSocket,
  eventName: string,
  request: ClientTransportCommandRequest
): Promise<CommandResult> {
  return new Promise((resolve) => {
    socket.emit(eventName, request, (result: unknown) => {
      resolve(readSocketIoCommandResult(result));
    });
  });
}

/**
 * Выполняет transport-level channel subscribe/unsubscribe через Socket.IO ack.
 */
function emitSocketIoChannelOperation(
  socket: SocketIoClientSocket,
  eventName: string,
  request: ClientTransportChannelRequest,
  stage: "subscribe" | "unsubscribe"
): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.emit(eventName, request, (result: unknown) => {
      if (isSocketIoOperationSuccess(result)) {
        resolve();
        return;
      }

      reject(
        reviveSocketIoRealtimeError(
          readSocketIoOperationFailurePayload(result),
          {
            code: "internal-error",
            message: `Socket.IO channel ${stage} failed.`,
            details: {
              stage
            }
          }
        )
      );
    });
  });
}

/**
 * Нормализует transport-level result команды обратно в общий command model.
 */
function readSocketIoCommandResult(result: unknown): CommandResult {
  if (
    typeof result !== "object" ||
    result === null ||
    typeof (result as { status?: unknown }).status !== "string"
  ) {
    return {
      status: "missing-ack"
    };
  }

  const normalizedResult = result as {
    readonly status: string;
    readonly error?: unknown;
  };

  if (normalizedResult.status === "ack") {
    return result as CommandResult;
  }

  if (normalizedResult.status === "missing-ack") {
    return {
      status: "missing-ack"
    };
  }

  if (normalizedResult.status === "timeout") {
    return {
      status: "timeout"
    };
  }

  if (normalizedResult.status === "error") {
    return {
      status: "error",
      error: reviveSocketIoRealtimeError(
        normalizedResult.error,
        {
          code: "command-failed",
          message: "Socket.IO command execution failed.",
          details: {
            stage: "transport"
          }
        }
      )
    };
  }

  return {
    status: "error",
    error: createRealtimeError({
      code: "command-failed",
      message: "Socket.IO command result is invalid.",
      details: {
        stage: "transport"
      }
    })
  };
}

function isSocketIoOperationSuccess(
  value: unknown
): value is {
  readonly ok: true;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === true
  );
}

function readSocketIoOperationFailurePayload(
  value: unknown
): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false
  ) {
    return (value as { error?: unknown }).error;
  }

  return value;
}

function reviveSocketIoRealtimeError(
  value: unknown,
  fallback: {
    readonly code: "command-failed" | "internal-error";
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  }
) {
  if (isRealtimeErrorPayload(value)) {
    try {
      if (value.details !== undefined) {
        return createRealtimeError({
          code: value.code,
          message: value.message,
          details: value.details
        });
      }

      return createRealtimeError({
        code: value.code,
        message: value.message
      });
    } catch {
      return createRealtimeError(fallback);
    }
  }

  return createRealtimeError(fallback);
}

function isRealtimeErrorPayload(value: unknown): value is RealtimeErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { name?: unknown }).name === "LiveRailRealtimeError" &&
    typeof (value as { code?: unknown }).code === "string" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

function isSocketIoSocketTransportOptions(
  options: CreateSocketIoClientTransportOptions
): options is CreateSocketIoClientTransportFromSocketOptions {
  return "socket" in options && options.socket !== undefined;
}

function isSocketIoUrlTransportOptions(
  options: CreateSocketIoClientTransportOptions
): options is CreateSocketIoClientTransportFromUrlOptions {
  return (
    "url" in options &&
    typeof options.url === "string" &&
    options.url.length > 0
  );
}
