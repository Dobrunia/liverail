# @liverail/client API Reference

> Generated file. Do not edit manually.

## Scope

Full public API reference for the client runtime and its official subpath exports.

## Entrypoint `@liverail/client`

### Values

- `createClientRuntime`: Создает базовый client runtime вокруг explicit contract registry.
- `applyEventApplier`: Валидирует payload по event contract и применяет его к текущему состоянию.
- `eventApplier`: Создает store-agnostic event applier, привязанный к typed event contract.

### Types

- `ContractRegistryIntrospection`: Read-only introspection shape полного registry.
- `SystemConnectionLifecycleState`: Единый lifecycle state для system events соединения.
- `SystemEvent`: Официальная модель встроенного системного realtime-события.
- `SystemEventName`: Официальное имя встроенного системного realtime-события.
- `SystemEventPayload`: Получает payload по имени встроенного системного события.
- `ClientConnectionLifecycleSnapshot`: Централизованный snapshot client connection lifecycle.
- `ClientConnectionLifecycleState`: Официальные состояния transport-agnostic client connection lifecycle.
- `ClientConnectionStateListener`: Listener изменений client connection lifecycle.
- `ClientRuntimeDebugSnapshot`: Read-only debug snapshot client runtime.
- `ClientRuntimeState`: Стабильное operational-состояние client runtime.
- `ClientRuntime`: Базовый client runtime, который знает про registry и lifecycle transport-а.
- `CreateClientRuntimeOptions`: Параметры создания transport-agnostic client runtime.
- `ExecuteClientChannelOperationOptions`: Параметры subscribe/unsubscribe channel operations в client runtime.
- `ExecuteClientCommandOptions`: Параметры выполнения typed команды в client runtime.
- `ClientEventListener`: Пользовательский listener конкретного typed события.
- `ClientSystemEventListener`: Пользовательский listener конкретного typed system event.
- `ClientRuntimeErrorHandler`: Централизованный обработчик нормализованных ошибок client runtime.
- `ClientEventApplier`: Pure-функция применения typed события к текущему состоянию.
- `ClientEventApplierDefinition`: Декларативное описание event applier, привязанное к конкретному event contract.
- `ClientStateStore`: Store-agnostic интерфейс доступа к текущему состоянию и записи следующего.
- `ClientChannelSubscription`: Активная клиентская подписка на конкретный channel instance.
- `ClientTransport`: Минимальный transport adapter для client runtime core.
- `ClientTransportConnectionEvent`: Transport-agnostic lifecycle event текущей client session.
- `ClientTransportConnectionReceiver`: Обработчик lifecycle-событий transport соединения.
- `ClientTransportConnectionStatus`: Официальные статусы transport connection lifecycle для client runtime.
- `ClientTransportChannelRequest`: Сырой outbound channel subscription request.
- `ClientTransportChannelSubscriber`: Минимальный transport sender для channel subscribe.
- `ClientTransportChannelUnsubscriber`: Минимальный transport sender для channel unsubscribe.
- `ClientTransportCommandRequest`: Сырой outbound command request, который client runtime отправляет в transport.
- `ClientTransportCommandSender`: Минимальный transport sender для command client API.
- `ClientTransportEvent`: Сырой inbound event, который transport передает в client runtime.
- `ClientTransportEventReceiver`: Обработчик inbound transport events внутри client runtime.

## Entrypoint `@liverail/client/socket-io`

### Values

- `SOCKET_IO_CHANNEL_JOIN_EVENT`: Официальное Socket.IO event name для transport-level channel join.
- `SOCKET_IO_CHANNEL_LEAVE_EVENT`: Официальное Socket.IO event name для transport-level channel leave.
- `SOCKET_IO_COMMAND_EVENT`: Официальное Socket.IO event name для transport-level command dispatch.
- `createSocketIoClientTransport`: Создает Socket.IO transport adapter, совместимый с client runtime.

### Types

- `CreateSocketIoClientTransportOptions`: Параметры создания Socket.IO client transport adapter.
- `SocketIoClientTransport`: Реальный Socket.IO transport adapter для client runtime.
