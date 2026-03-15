import assert from "node:assert/strict";
import { createServer, type Server as HttpServer } from "node:http";

import { io as createSocketClient, type Socket as ClientSocket } from "socket.io-client";
import {
  Server as SocketIoServer,
  type Socket as SocketIoServerSocket
} from "socket.io";
import { test } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  connectPolicy,
  createContractRegistry,
  event,
  receivePolicy
} from "dobrunia-liverail-contracts";
import {
  createServerRuntime,
  type ServerEventRoute,
  type ServerEventRecipient
} from "../src/index.ts";
import {
  createSocketIoChannelRoute,
  createSocketIoEventDeliverer,
  getSocketIoChannelRoom,
  createSocketIoServerAdapter,
  createSocketIoSocketRoute,
  SOCKET_IO_CHANNEL_JOIN_EVENT,
  SOCKET_IO_CHANNEL_LEAVE_EVENT,
  SOCKET_IO_COMMAND_EVENT
} from "../src/socket-io-entry.ts";

/**
 * Проверяет, что Socket.IO server adapter остается тонким transport-слоем:
 * он только принимает transport-события, строит context, вызывает готовый
 * server runtime и отдает обратно transport-friendly результаты.
 * Это важно, потому что core command/join/leave логика уже живет в runtime и
 * не должна дублироваться или разъезжаться внутри transport-интеграции.
 * Также покрываются corner cases с join и leave, чтобы adapter одинаково
 * связывал runtime membership и реальные Socket.IO rooms на одном socket.
 */
test("should execute commands and channel membership through the Socket.IO server adapter", async () => {
  const harness = await createSocketIoHarness();
  const sendMessage = command("send-message", {
    input: z.object({
      text: z.string().trim().min(1)
    }),
    ack: z.object({
      saved: z.literal(true),
      userId: z.string()
    })
  });
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      commands: [sendMessage] as const,
      channels: [voiceRoom] as const
    }),
    commandHandlers: {
      "send-message": ({ context }) => ({
        saved: true as const,
        userId: context.userId
      })
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId)
      };
    }
  });

  const client = createSocketClient(harness.url, {
    auth: {
      userId: "user-1"
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");

    const commandResult = await emitWithAck(client, SOCKET_IO_COMMAND_EVENT, {
      name: "send-message",
      input: {
        text: "  hello  "
      }
    });

    const joinResult = await emitWithAck(client, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    const membersAfterJoin = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });
    const leaveResult = await emitWithAck(client, SOCKET_IO_CHANNEL_LEAVE_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    const membersAfterLeave = runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    });

    assert.deepEqual(commandResult, {
      status: "ack",
      ack: {
        saved: true,
        userId: "user-1"
      }
    });
    assert.deepEqual(joinResult, {
      ok: true
    });
    assert.equal(membersAfterJoin.length, 1);
    assert.equal(membersAfterJoin[0]?.memberId, client.id);
    assert.deepEqual(membersAfterJoin[0]?.context, {
      userId: "user-1"
    });
    assert.deepEqual(leaveResult, {
      ok: true
    });
    assert.deepEqual(membersAfterLeave, []);
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что connection policy runtime не теряется внутри Socket.IO
 * middleware и до клиента доходит официальный `connection-denied`, а не сырой
 * transport-specific отказ или внутреннее исключение Socket.IO.
 * Это важно, потому что transport adapter не должен вводить собственную модель
 * connect-ошибок поверх уже существующего unified realtime error model.
 * Также покрывается corner case с auth-less подключением, чтобы adapter умел
 * отклонять session еще на handshake-этапе через стандартный `connect_error`.
 */
test("should reject denied Socket.IO connections with the unified realtime error model", async () => {
  const harness = await createSocketIoHarness();
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({}),
    connectionPolicies: [
      connectPolicy("requires-user", {
        evaluate({ context }) {
          return context.userId.length > 0 || {
            allowed: false as const,
            code: "connection-denied" as const,
            message: "Authentication is required."
          };
        }
      })
    ]
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId ?? "")
      };
    }
  });

  const client = createSocketClient(harness.url, {
    auth: {},
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    const error = await waitForSocketEvent<Error & {
      data?: {
        code?: string;
        message?: string;
      };
    }>(client, "connect_error");

    assert.equal(error.message, "Authentication is required.");
    assert.deepEqual(error.data, {
      code: "connection-denied",
      message: "Authentication is required.",
      name: "LiveRailRealtimeError"
    });
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что Socket.IO adapter доставляет server events и в конкретный
 * socket, и в channel room, используя один и тот же transport-specific
 * deliverer без дублирования бизнес-логики в event pipeline.
 * Это важно, потому что transport layer должен лишь материализовать route,
 * а вся маршрутизация по contracts должна продолжать жить в server runtime.
 * Также покрывается corner case с нетаргетированным клиентом, чтобы adapter
 * не рассылал событие шире, чем указано в socket и channel route helpers.
 */
test("should deliver runtime events to Socket.IO sockets and channel rooms", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  let directTargetSocketId = "";
  const runtime = createServerRuntime<{ userId: string }>({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [messageCreated] as const
    }),
    eventRouters: {
      "message-created": () => [
        createSocketIoChannelRoute("voice-room", {
          roomId: "room-1"
        }),
        createSocketIoSocketRoute(directTargetSocketId)
      ]
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(harness.io)
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {
        userId: "server-test"
      };
    }
  });

  const roomClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const directClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const ignoredClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await Promise.all([
      waitForSocketEvent(roomClient, "connect"),
      waitForSocketEvent(directClient, "connect"),
      waitForSocketEvent(ignoredClient, "connect")
    ]);
    directTargetSocketId = directClient.id ?? "";

    const roomEvent = waitForSocketEvent<{ text: string }>(
      roomClient,
      "message-created"
    );
    const directEvent = waitForSocketEvent<{ text: string }>(
      directClient,
      "message-created"
    );
    let ignoredReceived = false;

    ignoredClient.once("message-created", () => {
      ignoredReceived = true;
    });

    await emitWithAck(roomClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    const deliveries = await runtime.emitEvent("message-created", {
      text: "hello"
    }, {
      context: {
        userId: "server-test"
      }
    });

    assert.equal(deliveries.length, 2);
    assert.deepEqual(await roomEvent, {
      text: "hello"
    });
    assert.deepEqual(await directEvent, {
      text: "hello"
    });

    await wait(50);

    assert.equal(ignoredReceived, false);
  } finally {
    roomClient.disconnect();
    directClient.disconnect();
    ignoredClient.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что receive policy enforcement не теряется при работе через
 * реальный Socket.IO deliverer и channel routes: запрещенный route должен
 * отфильтровываться еще до transport-доставки и не доходить до сокета.
 * Это важно, потому что security-модель не должна зависеть от того, какой
 * deliverer выбран поверх runtime; transport helper не должен обходить policy,
 * если используется через официальный event pipeline. Также покрывается corner
 * case с двумя channel route одного события, чтобы deny одного получателя не
 * ломал доставку второму разрешенному подписчику.
 */
test("should enforce receive policies before Socket.IO channel delivery", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  const allowedRoomId = getSocketIoChannelRoom("voice-room", {
    roomId: "room-1"
  });
  const runtime = createServerRuntime<{ allowedRoomId: string }>({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [messageCreated] as const
    }),
    eventReceivePolicies: {
      "message-created": [
        receivePolicy("can-receive-room-message", {
          evaluate({ route, context }) {
            return (
              (
                route.metadata as
                  | {
                      readonly roomId?: string;
                    }
                  | undefined
              )?.roomId === context.allowedRoomId
            );
          }
        })
      ]
    },
    eventRouters: {
      "message-created": () => [
        createSocketIoChannelRoute("voice-room", {
          roomId: "room-1"
        }),
        createSocketIoChannelRoute("voice-room", {
          roomId: "room-2"
        })
      ]
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(harness.io)
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {
        allowedRoomId
      };
    }
  });

  const allowedClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const blockedClient = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await Promise.all([
      waitForSocketEvent(allowedClient, "connect"),
      waitForSocketEvent(blockedClient, "connect")
    ]);

    await emitWithAck(allowedClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    await emitWithAck(blockedClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-2"
      }
    });

    const allowedDelivery = waitForSocketEvent<{ text: string }>(
      allowedClient,
      "message-created"
    );
    let blockedReceived = false;

    blockedClient.once("message-created", () => {
      blockedReceived = true;
    });

    const deliveries = await runtime.emitEvent("message-created", {
      text: "policy-checked"
    }, {
      context: {
        allowedRoomId
      }
    });
    await wait(50);

    assert.equal(deliveries.length, 1);
    assert.deepEqual(await allowedDelivery, {
      text: "policy-checked"
    });
    assert.equal(blockedReceived, false);
  } finally {
    allowedClient.disconnect();
    blockedClient.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что receive policy теперь применяется к конкретным участникам
 * внутри одного и того же channel route, а не только к room как целому.
 * Это важно, потому что до исправления `createSocketIoChannelRoute` вместе с
 * Socket.IO deliverer-ом фактически обходили per-recipient policy enforcement:
 * одно разрешение на route означало broadcast всей room. Также покрывается
 * corner case с двумя участниками одной room, чтобы deny второго получателя
 * не мешал доставке первому и не требовал ручного fan-out в user-коде.
 */
test("should enforce receive policies per recipient inside the same Socket.IO room", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  const registry = createContractRegistry({
    channels: [voiceRoom] as const,
    events: [messageCreated] as const
  });
  type RuntimeContext = {
    readonly userId: string;
    readonly allowedSocketId?: string;
  };
  const runtime = createServerRuntime<RuntimeContext, typeof registry>({
    registry,
    eventReceivePolicies: {
      "message-created": [
        receivePolicy<
          "can-receive-room-message",
          typeof messageCreated,
          RuntimeContext,
          ServerEventRoute,
          "forbidden",
          ServerEventRecipient<RuntimeContext>
        >("can-receive-room-message", {
          evaluate({ recipient, context }) {
            return recipient?.memberId === context.allowedSocketId;
          }
        })
      ]
    },
    eventRouters: {
      "message-created": () => createSocketIoChannelRoute("voice-room", {
        roomId: "room-1"
      })
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(harness.io)
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext(socket) {
      return {
        userId: String(socket.handshake.auth.userId ?? "")
      };
    }
  });

  const allowedClient = createSocketClient(harness.url, {
    auth: {
      userId: "allowed-user"
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });
  const blockedClient = createSocketClient(harness.url, {
    auth: {
      userId: "blocked-user"
    },
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await Promise.all([
      waitForSocketEvent(allowedClient, "connect"),
      waitForSocketEvent(blockedClient, "connect")
    ]);

    await emitWithAck(allowedClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    await emitWithAck(blockedClient, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    const allowedDelivery = waitForSocketEvent<{ text: string }>(
      allowedClient,
      "message-created"
    );
    let blockedReceived = false;

    blockedClient.once("message-created", () => {
      blockedReceived = true;
    });

    const deliveries = await runtime.emitEvent("message-created", {
      text: "recipient-filtered"
    }, {
      context: {
        userId: "server",
        allowedSocketId: allowedClient.id ?? ""
      }
    });
    await wait(50);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.recipient?.memberId, allowedClient.id);
    assert.deepEqual(await allowedDelivery, {
      text: "recipient-filtered"
    });
    assert.equal(blockedReceived, false);
  } finally {
    allowedClient.disconnect();
    blockedClient.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что Socket.IO deliverer больше не принимает неразвернутый
 * channel route напрямую и не делает room-wide broadcast без явного
 * per-member fan-out от runtime.
 * Это важно, потому что иначе transport helper по-прежнему оставался бы
 * обходным путем мимо исправленного receive-policy enforcement.
 */
test("should reject unresolved Socket.IO channel routes at delivery time", async () => {
  const harness = await createSocketIoHarness();
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  const deliverer = createSocketIoEventDeliverer(harness.io);

  try {
    await assert.rejects(
      () =>
        Promise.resolve(deliverer({
          contract: messageCreated,
          name: "message-created",
          payload: {
            text: "unsafe-broadcast"
          },
          context: {},
          route: createSocketIoChannelRoute("voice-room", {
            roomId: "room-1"
          })
        })),
      /concrete memberId/
    );
  } finally {
    await harness.close();
  }
});

/**
 * Проверяет, что неуспешный `socket.join()` не оставляет после себя runtime
 * membership, если transport-level привязка комнаты сорвалась уже после
 * успешной server-side авторизации и создания channel membership.
 * Это важно, потому что иначе adapter будет возвращать ошибку join, но сервер
 * продолжит считать клиента участником канала, что ломает cleanup и security-
 * модель membership. Также покрывается corner case с transport failure после
 * runtime join, чтобы adapter делал rollback, а не оставлял полусобранное
 * состояние между runtime и Socket.IO.
 */
test("should rollback runtime membership when Socket.IO room join fails", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    })
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {};
    }
  });

  harness.io.on("connection", (socket) => {
    socket.join = async () => {
      throw new Error("Socket.IO room join failed.");
    };
  });

  const client = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");

    const joinResult = await emitWithAck<{
      readonly ok?: boolean;
      readonly error?: {
        readonly code?: string;
        readonly message?: string;
        readonly details?: {
          readonly stage?: string;
        };
      };
    }>(client, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    assert.equal(joinResult.ok, false);
    assert.equal(joinResult.error?.code, "internal-error");
    assert.equal(joinResult.error?.details?.stage, "join");
    assert.match(
      String(joinResult.error?.message),
      /Socket\.IO channel operation failed at stage "join"/
    );
    assert.deepEqual(runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }), []);
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что неуспешный `socket.leave()` не удаляет runtime membership
 * раньше времени и не создает рассинхронизацию, когда transport еще держит
 * клиента в комнате, а сервер уже считает его отписанным.
 * Это важно, потому что именно такая рассинхронизация приводит к утечке
 * событий после неудачного unsubscribe/leave и ломает заявленные cleanup
 * guarantees. Также покрывается corner case с повторной успешной попыткой:
 * после исправленного adapter-а leave можно повторить и получить чистое
 * состояние без зависшей membership и без лишней доставки событий.
 */
test("should keep runtime and transport membership aligned when Socket.IO leave fails", async () => {
  const harness = await createSocketIoHarness();
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string().min(1)
    })
  });
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string()
    })
  });
  let failLeave = true;
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const,
      events: [messageCreated] as const
    }),
    eventRouters: {
      "message-created": () => createSocketIoChannelRoute("voice-room", {
        roomId: "room-1"
      })
    },
    eventDeliverers: {
      "message-created": createSocketIoEventDeliverer(harness.io)
    }
  });

  createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {};
    }
  });

  harness.io.on("connection", (socket) => {
    const originalLeave = socket.leave.bind(socket);

    socket.leave = async (...args) => {
      if (failLeave) {
        throw new Error("Socket.IO room leave failed.");
      }

      await originalLeave(...args);
    };
  });

  const client = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");
    await emitWithAck(client, SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    const failedLeaveResult = await emitWithAck<{
      readonly ok?: boolean;
      readonly error?: {
        readonly code?: string;
        readonly message?: string;
        readonly details?: {
          readonly stage?: string;
        };
      };
    }>(client, SOCKET_IO_CHANNEL_LEAVE_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });

    let leakedAfterFailedLeave: { text: string } | undefined;

    client.once("message-created", (payload: { text: string }) => {
      leakedAfterFailedLeave = payload;
    });

    await runtime.emitEvent("message-created", {
      text: "still-subscribed"
    }, {
      context: {}
    });
    await wait(50);

    assert.equal(failedLeaveResult.ok, false);
    assert.equal(failedLeaveResult.error?.code, "internal-error");
    assert.equal(failedLeaveResult.error?.details?.stage, "leave");
    assert.match(
      String(failedLeaveResult.error?.message),
      /Socket\.IO channel operation failed at stage "leave"/
    );
    assert.equal(
      runtime.listChannelMembers("voice-room", {
        roomId: "room-1"
      }).length,
      1
    );
    assert.deepEqual(leakedAfterFailedLeave, {
      text: "still-subscribed"
    });

    failLeave = false;

    const successfulLeaveResult = await emitWithAck<{
      readonly ok: true;
    }>(client, SOCKET_IO_CHANNEL_LEAVE_EVENT, {
      name: "voice-room",
      key: {
        roomId: "room-1"
      }
    });
    let receivedAfterSuccessfulLeave = false;

    client.once("message-created", () => {
      receivedAfterSuccessfulLeave = true;
    });

    await runtime.emitEvent("message-created", {
      text: "after-successful-leave"
    }, {
      context: {}
    });
    await wait(50);

    assert.deepEqual(successfulLeaveResult, {
      ok: true
    });
    assert.deepEqual(runtime.listChannelMembers("voice-room", {
      roomId: "room-1"
    }), []);
    assert.equal(receivedAfterSuccessfulLeave, false);
  } finally {
    client.disconnect();
    await harness.close();
  }
});

/**
 * Проверяет, что после `dispose()` можно безопасно создать новый adapter на
 * том же `io` и namespace без наследования middleware от старого экземпляра.
 * Это важно, потому что старый teardown-path снимал только `connection`
 * listener и оставлял disposed middleware активным, из-за чего новые
 * подключения после recreate стабильно падали с `adapter is disposed`.
 */
test("should allow recreating the Socket.IO server adapter after dispose", async () => {
  const harness = await createSocketIoHarness();
  const runtime = createServerRuntime({
    registry: createContractRegistry({})
  });
  const firstAdapter = createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {};
    }
  });

  firstAdapter.dispose();

  const secondAdapter = createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {};
    }
  });
  const client = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    const result = await Promise.race([
      waitForSocketEvent(client, "connect").then(() => "connected" as const),
      waitForSocketEvent<Error & {
        readonly data?: {
          readonly code?: string;
        };
      }>(client, "connect_error").then((error) => ({
        status: "error" as const,
        code: error.data?.code
      }))
    ]);

    assert.deepEqual(result, "connected");
  } finally {
    client.disconnect();
    secondAdapter.dispose();
    await harness.close();
  }
});

/**
 * Проверяет, что `dispose()` снимает только liveRail-обработчики конкретного
 * сокета и не удаляет чужие listeners на тех же transport event names.
 * Это важно, потому что Socket.IO boundary может разделяться с кодом
 * приложения, и teardown адаптера не должен ломать постороннюю интеграцию.
 */
test("should preserve foreign Socket.IO listeners when disposing the adapter", async () => {
  const harness = await createSocketIoHarness();
  const runtime = createServerRuntime({
    registry: createContractRegistry({})
  });
  const adapter = createSocketIoServerAdapter({
    io: harness.io,
    runtime,
    resolveContext() {
      return {};
    }
  });
  const seenEvents: string[] = [];
  let serverSocket:
    | SocketIoServerSocket
    | undefined;
  let restoreDisconnect: (() => void) | undefined;

  harness.io.on("connection", (socket) => {
    serverSocket = socket;
    socket.on(SOCKET_IO_COMMAND_EVENT, (request: { name?: string }) => {
      seenEvents.push(`command:${request.name ?? "unknown"}`);
    });
    socket.on(SOCKET_IO_CHANNEL_JOIN_EVENT, (request: { name?: string }) => {
      seenEvents.push(`join:${request.name ?? "unknown"}`);
    });
    socket.on(SOCKET_IO_CHANNEL_LEAVE_EVENT, (request: { name?: string }) => {
      seenEvents.push(`leave:${request.name ?? "unknown"}`);
    });

    const originalDisconnect = socket.disconnect.bind(socket);

    socket.disconnect = (() => socket) as typeof socket.disconnect;
    restoreDisconnect = () => {
      socket.disconnect = originalDisconnect;
    };
  });

  const client = createSocketClient(harness.url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"]
  });

  try {
    await waitForSocketEvent(client, "connect");
    await wait(25);

    assert.ok(serverSocket !== undefined);

    adapter.dispose();

    client.emit(SOCKET_IO_COMMAND_EVENT, {
      name: "foreign-command",
      input: undefined
    });
    client.emit(SOCKET_IO_CHANNEL_JOIN_EVENT, {
      name: "foreign-join",
      key: undefined
    });
    client.emit(SOCKET_IO_CHANNEL_LEAVE_EVENT, {
      name: "foreign-leave",
      key: undefined
    });
    await wait(25);

    assert.deepEqual(seenEvents, [
      "command:foreign-command",
      "join:foreign-join",
      "leave:foreign-leave"
    ]);
  } finally {
    restoreDisconnect?.();
    client.disconnect();
    await harness.close();
  }
});

interface SocketIoHarness {
  readonly io: SocketIoServer;
  readonly url: string;
  readonly close: () => Promise<void>;
}

async function createSocketIoHarness(): Promise<SocketIoHarness> {
  const httpServer = createServer();
  const io = new SocketIoServer(httpServer, {
    serveClient: false
  });

  await listenHttpServer(httpServer);

  const address = httpServer.address();

  if (address === null || typeof address === "string") {
    throw new TypeError("Socket.IO test server did not expose a numeric port.");
  }

  return {
    io,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await closeSocketIoServer(io);
    }
  };
}

function listenHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function closeSocketIoServer(server: SocketIoServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function emitWithAck<TResult>(
  socket: ClientSocket,
  eventName: string,
  payload: unknown
): Promise<TResult> {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, (result: TResult) => {
      resolve(result);
    });
  });
}

function waitForSocketEvent<TPayload = void>(
  socket: ClientSocket,
  eventName: string,
  timeoutMs = 1_000
): Promise<TPayload> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timed out while waiting for Socket.IO event: ${eventName}.`));
    }, timeoutMs);

    socket.once(eventName, (payload: TPayload) => {
      clearTimeout(timeoutId);
      resolve(payload);
    });
  });
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
