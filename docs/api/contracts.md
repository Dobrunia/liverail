# dobrunia-liverail-contracts API Reference

> Generated file. Do not edit manually.

## Scope

Full public API reference for the shared contract, validation, policy and registry layer.

## Entrypoint `dobrunia-liverail-contracts`

### Values

- `REALTIME_ERROR_CODES`: Официальный список кодов ошибок, который разделяют все слои библиотеки.
- `REALTIME_VALIDATION_ERROR_CODES`: Официальные коды ошибок, относящиеся именно к validation-слою.
- `LiveRailRealtimeError`: Единая runtime-ошибка библиотеки с официальным кодом и стабильным shape.
- `createRealtimeError`: Создает unified realtime error общего формата.
- `isRealtimeError`: Проверяет, является ли значение официальной realtime-ошибкой библиотеки.
- `isRealtimeValidationError`: Проверяет, что значение является нормализованной validation-ошибкой и безопасно открывает доступ к `source` и `issues`.
- `normalizeValidationError`: Нормализует schema/runtime ошибку в единый realtime error shape для validation-слоя.
- `voidSchema`: Официальная schema для самых частых no-payload сценариев без ручного импорта `z.void()` в пользовательском коде.
- `SYSTEM_EVENT_NAMES`: Официальные имена встроенных системных realtime-событий.
- `createSystemEvent`: Создает явно маркированное системное realtime-событие.
- `isSystemEventName`: Проверяет, что строка является официальным именем системного события.
- `COMMAND_ACK_STATUSES`: Официальные статусы transport-agnostic command acknowledgement model.
- `COMMAND_RESULT_STATUSES`: Официальные статусы полного transport-agnostic результата команды.
- `command`: Создает декларативный command-примитив с устойчивой неизменяемой формой.
- `parseCommandAck`: Валидирует и нормализует ack команды по ее Zod-схеме.
- `parseCommandInput`: Валидирует и нормализует input команды по ее Zod-схеме.
- `event`: Создает декларативный event-примитив с устойчивой неизменяемой формой.
- `parseEventPayload`: Валидирует и нормализует payload события по его Zod-схеме.
- `channel`: Создает декларативный channel-примитив с устойчивой неизменяемой формой.
- `createChannelInstance`: Создает конкретный channel instance из шаблонного контракта и сырого ключа.
- `isSameChannelInstance`: Проверяет равенство двух channel instances по каноническому идентификатору.
- `parseChannelInstance`: Разбирает канонический channel instance id и восстанавливает typed instance.
- `parseChannelKey`: Валидирует и нормализует ключ channel instance по его Zod-схеме.
- `stringifyChannelInstance`: Сериализует channel instance или его нормализованные части в один канонический строковый идентификатор.
- `POLICY_SCOPES`: Поддерживаемые scope-значения для policy layer.
- `andPolicy`: Композиция policy через логическое `and` с коротким замыканием на первом deny.
- `commandPolicy`: Создает command policy с фиксированным scope `command`.
- `connectPolicy`: Создает connect policy с фиксированным scope `connect`.
- `joinPolicy`: Создает join policy с фиксированным scope `join`.
- `notPolicy`: Композиция policy через логическое `not`.
- `orPolicy`: Композиция policy через логическое `or` с коротким замыканием на первом allow.
- `policy`: Создает декларативный policy-примитив и сохраняет evaluator без скрытых адаптеров или оберток.
- `receivePolicy`: Создает receive policy с фиксированным scope `receive`.
- `createContractRegistry`: Создает явную registry-модель контрактов без скрытого глобального состояния.
- `defineChannels`: Создает неизменяемый typed tuple channel-контрактов без ручного `as const`.
- `defineCommands`: Создает неизменяемый typed tuple command-контрактов без ручного `as const`.
- `defineEvents`: Создает неизменяемый typed tuple event-контрактов без ручного `as const`.
- `definePolicies`: Создает неизменяемый typed tuple policy-контрактов без ручного `as const`.
- `inspectContractRegistry`: Возвращает безопасный read-only introspection snapshot registry без доступа к внутренним структурам runtime.

### Types

- `CreateRealtimeErrorOptions`: Параметры создания unified realtime error.
- `NormalizeValidationErrorOptions`: Параметры нормализации validation-ошибки в unified realtime error shape.
- `RealtimeErrorCode`: Допустимый код unified realtime error model.
- `RealtimeErrorDetails`: Дополнительные сериализуемые детали realtime-ошибки.
- `RealtimeErrorPayload`: JSON-совместимая форма realtime-ошибки для transport/logging сценариев.
- `RealtimeValidationError`: Нормализованная validation-ошибка в общем realtime формате.
- `RealtimeValidationErrorCode`: Подмножество realtime error codes для validation-сценариев.
- `RealtimeValidationErrorDetails`: Детали validation-ошибки в unified realtime error shape.
- `RealtimeValidationErrorSource`: Источник validation-ошибки до нормализации.
- `RealtimeValidationIssue`: Нормализованная issue-запись внутри validation-ошибки.
- `RuntimeContext`: Базовый тип runtime-контекста, который будет разделяться сервером, клиентом и policy/handler-слоями.
- `AnyContractSchema`: Общий тип schema-ссылки, пригодный для всех видов контрактов.
- `ContractSchema`: Общий тип Zod-схемы, используемой одновременно для runtime validation и type inference.
- `InferSchemaInput`: Выводит входной тип schema.
- `InferSchemaOutput`: Выводит нормализованный выходной тип schema.
- `ResolveSchemaInput`: Нормализует входной тип schema с учетом отсутствующего значения.
- `ResolveSchemaOutput`: Нормализует выходной тип schema с учетом отсутствующего значения.
- `ContractMetadata`: Произвольные метаданные, сопровождающие объявление контракта.
- `ContractPrimitive`: Базовая форма любого декларативного realtime-примитива.
- `ContractPrimitiveKind`: Допустимые виды базовых realtime-примитивов.
- `ContractPrimitiveOptions`: Общие опции для декларативных contract-примитивов.
- `SystemConnectionLifecycleState`: Единый lifecycle state для system events соединения.
- `SystemEvent`: Официальная модель встроенного системного realtime-события.
- `SystemEventName`: Официальное имя встроенного системного realtime-события.
- `SystemEventPayload`: Получает payload по имени встроенного системного события.
- `SystemEventPayloadMap`: Таблица payload-ов встроенных системных realtime-событий.
- `CommandAckResult`: Transport-agnostic результат ожидания command acknowledgement.
- `CommandAckStatus`: Допустимый статус transport-level подтверждения команды.
- `CommandAckSuccess`: Явное transport-level подтверждение команды с ack payload.
- `CommandAck`: Получает нормализованный тип ack-ответа команды.
- `CommandContext`: Типизированный контекст исполнения команды.
- `CommandContract`: Декларативный контракт команды.
- `CommandErrorResult`: Явная transport-level ошибка выполнения команды без ack payload.
- `CommandInput`: Получает нормализованный тип входных данных команды.
- `CommandResult`: Полная transport-agnostic result model для выполнения команды.
- `CommandResultStatus`: Допустимый статус transport-level результата выполнения команды.
- `CommandTimeoutResult`: Явный transport-level timeout ожидания результата команды.
- `MissingCommandAck`: Явное transport-level отсутствие ack.
- `CommandOptions`: Опции декларативной команды с общими schema-ссылками.
- `EventContext`: Типизированный контекст обработки server-to-client события.
- `EventContract`: Декларативный контракт server-to-client события.
- `EventOptions`: Опции декларативного события.
- `EventPayload`: Получает нормализованный тип payload события.
- `ChannelContext`: Типизированный контекст работы с channel instance.
- `ChannelContract`: Декларативный контракт канала подписки.
- `ChannelInstance`: Конкретный instance канала с уже валидированным ключом.
- `ChannelKey`: Получает нормализованный тип ключа канала.
- `ChannelOptions`: Опции декларативного канала.
- `CommandPolicyContext`: Контекст command policy.
- `CommandPolicyContract`: Специализированный policy-контракт для command access layer.
- `CommandPolicyErrorCode`: Допустимые deny-коды для command policy.
- `CommandPolicyOptions`: Опции command policy.
- `ConnectPolicyContext`: Контекст connection policy.
- `ConnectPolicyContract`: Специализированный policy-контракт для connection access layer.
- `ConnectPolicyErrorCode`: Допустимые deny-коды для connection policy.
- `ConnectPolicyOptions`: Опции connection policy.
- `JoinPolicyContext`: Контекст join policy.
- `JoinPolicyContract`: Специализированный policy-контракт для channel join layer.
- `JoinPolicyErrorCode`: Допустимые deny-коды для join policy.
- `JoinPolicyOptions`: Опции join policy.
- `PolicyAllowDecision`: Явное разрешение policy-проверки.
- `PolicyCompositionOptions`: Общие опции policy-composition helper-ов.
- `PolicyContext`: Типизированный контекст исполнения policy.
- `PolicyDecision`: Явная policy-decision форма поверх boolean-результата.
- `PolicyDenyDecision`: Явный отказ policy-проверки с официальным error code.
- `PolicyContract`: Декларативный контракт policy с прикрепленной функцией проверки.
- `PolicyEvaluator`: Функция проверки доступа или иного runtime-условия.
- `PolicyOptions`: Опции декларативной policy-сущности.
- `PolicyResolution`: Нормализованный результат policy-проверки до async-обертки.
- `PolicyResult`: Результат исполнения policy-проверки.
- `PolicyScope`: Официальный scope policy layer.
- `ReceivePolicyContext`: Контекст receive policy.
- `ReceivePolicyContract`: Специализированный policy-контракт для receive layer.
- `ReceivePolicyErrorCode`: Допустимые deny-коды для receive policy.
- `ReceivePolicyOptions`: Опции receive policy.
- `AnyContract`: Любой поддерживаемый контракт, который можно поместить в registry.
- `ContractIntrospectionBucket`: Read-only introspection bucket поверх registry с контрактами и их именами.
- `ContractNames`: Кортеж имен контрактов в порядке их регистрации.
- `ContractRegistry`: Единая детерминированная registry-модель всех contracts проекта.
- `ContractRegistryIntrospection`: Read-only introspection shape полного registry.
- `ContractRegistryBucket`: Детерминированная коллекция контрактов одного вида.
- `ContractRegistryDefinition`: Входные данные для явного построения registry.
- `ContractsByName`: Отображение набора контрактов в lookup-объект по их именам.
