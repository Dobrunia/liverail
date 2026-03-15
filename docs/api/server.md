# dobrunia-liverail-server API Reference

> Generated file. Do not edit manually.

## Scope

Full public API reference for the server runtime and its official subpath exports.

## Entrypoint `dobrunia-liverail-server`

### Values

- `createServerRuntime`: Создает базовый server runtime вокруг explicit contract registry.
- `defineServerRuntime`: Создает server runtime с усиленным authoring-time inference публичного API. Runtime-поведение полностью делегируется обычному `createServerRuntime`.
- `createServerRuntimeContext`: Создает единый transport-agnostic context для connect/policy/handler слоев.

### Types

- `ContractRegistryIntrospection`: Read-only introspection shape полного registry.
- `ChannelMembership`: Текущая membership-запись конкретного channel instance.
- `CreateServerRuntimeOptions`: Параметры создания transport-agnostic server runtime.
- `DefineServerRuntimeOptions`: Параметры strongly typed server runtime helper с выводом context из публичных policy/handler сигнатур без обязательного явного generic на runtime factory.
- `ExecuteServerConnectionOptions`: Параметры connection authorization в runtime.
- `ExecuteServerJoinOptions`: Параметры join-операции в channel membership runtime.
- `ExecuteServerLeaveOptions`: Параметры leave-операции в channel membership runtime.
- `ExecuteServerCommandOptions`: Параметры выполнения конкретного command pipeline.
- `ExecuteServerEventOptions`: Параметры выполнения конкретного event emission pipeline.
- `ServerCommandPolicies`: Набор command policy-контрактов, зарегистрированных в runtime по command name.
- `ServerConnectionPolicies`: Набор connect policy, подключенных к runtime.
- `ServerEventReceivePolicies`: Набор receive policy-контрактов, зарегистрированных в runtime по event name.
- `ServerChannelJoinAuthorizer`: Authorizer typed join-операции для channel membership runtime.
- `ServerChannelJoinAuthorizers`: Набор join authorizer-ов каналов, зарегистрированных в runtime.
- `ServerChannelJoinExecution`: Server-specific execution context для channel join pipeline.
- `ServerChannelJoinPolicies`: Набор join policy-контрактов, зарегистрированных в runtime по channel name.
- `ServerChannelLeaveExecution`: Server-specific execution context для channel leave lifecycle.
- `ServerCommandExecution`: Server-specific execution context для command pipeline.
- `ServerCommandAuthorizer`: Typed authorizer для command pipeline.
- `ServerCommandAuthorizers`: Набор authorizer-ов команд, зарегистрированных в runtime.
- `ServerCommandHandler`: Typed handler команды внутри server runtime.
- `ServerCommandHandlers`: Набор handler-ов команд, зарегистрированных в runtime.
- `ServerConnectionLifecycle`: Нормализованная lifecycle-модель конкретного server connection.
- `ServerConnectionLifecycleHook`: Hook обработки server connection lifecycle.
- `ServerEventDeliverer`: Typed deliverer для конкретного server event.
- `ServerEventDeliverers`: Набор deliverer-ов событий, зарегистрированных в runtime.
- `ServerEventDelivery`: Финальная delivery-запись конкретного server event.
- `ServerEventEmission`: Server-specific execution context для event emission pipeline.
- `ServerEventRecipient`: Конкретный получатель delivery после fan-out channel audience до участника.
- `ServerEventRoute`: Нормализованная route-запись event emission pipeline.
- `ServerEventRouter`: Typed router для event emission pipeline.
- `ServerEventRouters`: Набор router-ов событий, зарегистрированных в runtime.
- `ServerJoinLifecycleHook`: Hook обработки lifecycle join конкретного channel instance.
- `ServerLeaveLifecycleHook`: Hook обработки lifecycle leave конкретного channel instance.
- `ServerLifecycleHooks`: Набор базовых lifecycle hooks server runtime.
- `ServerRuntimeActiveChannelDebug`: Read-only debug entry активного channel instance.
- `ServerRuntimeDebugSnapshot`: Read-only debug snapshot server runtime.
- `ServerRuntimeState`: Стабильное operational-состояние server runtime.
- `ServerRuntime`: Базовый server runtime, который знает только про registry и typed lookup contracts, не привязываясь к конкретному транспорту.
- `CreateServerRuntimeContextOptions`: Параметры сборки unified server runtime context.
- `ServerConnection`: Transport-agnostic описание активного realtime-соединения.
- `ServerRuntimeContext`: Официальный unified runtime context серверной части.
- `ServerRuntimeContextInit`: Transport-level данные, которых достаточно для построения unified context.

## Entrypoint `dobrunia-liverail-server/socket-io`

### Values

- `SOCKET_IO_CHANNEL_JOIN_EVENT`: Официальное Socket.IO event name для transport-level join запроса.
- `SOCKET_IO_CHANNEL_LEAVE_EVENT`: Официальное Socket.IO event name для transport-level leave запроса.
- `SOCKET_IO_COMMAND_EVENT`: Официальное Socket.IO event name для transport-level command dispatch.
- `createSocketIoChannelRoute`: Создает route для доставки события в конкретную Socket.IO room канала.
- `createSocketIoEventDeliverer`: Создает transport deliverer для уже построенных Socket.IO routes.
- `createSocketIoServerAdapter`: Создает thin Socket.IO adapter, который связывает transport events с runtime.
- `createSocketIoSocketRoute`: Создает route для доставки события в конкретный Socket.IO socket.
- `getSocketIoChannelRoom`: Возвращает детерминированное Socket.IO room name для channel instance.

### Types

- `CreateSocketIoServerAdapterOptions`: Параметры создания thin Socket.IO adapter поверх server runtime.
- `SocketIoChannelRequest`: Transport-level request shape для join/leave операций канала.
- `SocketIoConnectionContextInjector`: Transport-level input для сборки официального unified runtime context.
- `SocketIoCommandRequest`: Transport-level request shape для выполнения команды через Socket.IO.
- `SocketIoConnectionContextResolver`: Функция построения runtime context из конкретного Socket.IO socket.
- `SocketIoOperationFailure`: Ошибочный transport-level результат channel операции.
- `SocketIoOperationResult`: Полная transport-level result model для join/leave через Socket.IO.
- `SocketIoOperationSuccess`: Успешный transport-level результат channel операции.
- `SocketIoServerAdapter`: Публичный handle созданного Socket.IO adapter.
