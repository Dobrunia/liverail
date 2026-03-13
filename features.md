# LiveRail — Ordered Implementation Plan (updated docs/tooling)

## 1. Foundation

### 1.1 Contract primitives
- [x] **Contract primitives: `command`, `event`, `channel`, `policy`**
  **Описание:** базовые фабрики и базовые сущности библиотеки.
  **Что делает:** задает единый язык описания realtime-системы.
  **Зачем нужна:** без этого нельзя строить ни сервер, ни клиент, ни transport layer.
  **Какие части затрагивает:** `contracts`
  **Архитектурные нюансы:** API должен быть минимальным и декларативным. Не делать сложный DSL.
  **Не забыть обновить:** -
  **Почему здесь:** это абсолютный фундамент.

### 1.2 Shared runtime and contract types
- [x] **Shared type system for contracts and runtime context**
  **Описание:** общие TypeScript-типы для command/event/channel/policy и контекста исполнения.
  **Что делает:** фиксирует shape всех сущностей и связывает пакеты между собой.
  **Зачем нужна:** иначе дальше начнут расходиться типы между `contracts`, `server` и `client`.
  **Какие части затрагивает:** `contracts`
  **Архитектурные нюансы:** типы должны выводиться из схем, а не требовать ручного дублирования.
  **Не забыть обновить:** все публичные сигнатуры из предыдущего шага.
  **Почему здесь:** сразу после primitives нужно зафиксировать общий язык типов.

### 1.3 Contract registry
- [x] **Contract registry model**
  **Описание:** единая модель хранения зарегистрированных commands/events/channels.
  **Что делает:** превращает отдельные контракты в связную систему.
  **Зачем нужна:** без registry нельзя строить runtime, export, tooling и интеграции.
  **Какие части затрагивает:** `contracts`, частично `server`, частично `client`
  **Архитектурные нюансы:** registry должен быть детерминированным и без скрытого глобального состояния.
  **Не забыть обновить:** фабрики `command/event/channel/policy`, чтобы они умели регистрироваться или быть совместимыми с registry.
  **Почему здесь:** все следующие фичи будут опираться на registry.

---

## 2. Validation Layer

### 2.1 Schema validation base
- [x] **Schema-based validation for payloads and keys**
  **Описание:** общая валидация схем через Zod для command input, event payload и channel key.
  **Что делает:** не дает данным “плавать” между клиентом и сервером.
  **Зачем нужна:** это базовый anti-chaos слой.
  **Какие части затрагивает:** `contracts`, потом `server`, потом `client`
  **Архитектурные нюансы:** одна схема должна использоваться и для runtime validation, и для type inference.
  **Не забыть обновить:** все contract primitives, чтобы они принимали и хранили схемы единообразно.
  **Почему здесь:** validation нужна до runtime.

### 2.2 Command contracts
- [x] **Command input and ack contracts**
  **Описание:** строгие схемы для входа команды и ее ack-ответа.
  **Что делает:** формализует client → server действие и server → client подтверждение.
  **Зачем нужна:** без этого команда быстро превращается в нестрогий `emit`.
  **Какие части затрагивает:** `contracts`
  **Архитектурные нюансы:** `ack` должен быть отдельной частью контракта, а не “любым объектом”.
  **Не забыть обновить:** общий тип command definition, registry, validation base.
  **Почему здесь:** command — одна из центральных сущностей.

### 2.3 Event contracts
- [x] **Event payload contracts**
  **Описание:** строгие схемы server-to-client событий.
  **Что делает:** фиксирует, какие события существуют и какой у них payload.
  **Зачем нужна:** без этого нет строгого realtime-слоя.
  **Какие части затрагивает:** `contracts`
  **Архитектурные нюансы:** одно событие = одно имя + один payload + один смысл.
  **Не забыть обновить:** event definition types, registry, validation base.
  **Почему здесь:** event contracts нужны раньше transport и client listeners.

### 2.4 Channel contracts
- [x] **Channel key contracts**
  **Описание:** строгая модель channel key, например `voice-room({ roomId })`.
  **Что делает:** убирает хаос из room names и адресации подписок.
  **Зачем нужна:** без этого комнаты быстро становятся набором строк.
  **Какие части затрагивает:** `contracts`
  **Архитектурные нюансы:** разделять channel template и конкретный channel instance.
  **Не забыть обновить:** registry и validation base, чтобы channels тоже были частью общего контракта.
  **Почему здесь:** channels — третья базовая сущность после command и event.

---

## 3. Error Model

### 3.1 Unified realtime error model
- [x] **Unified realtime error model**
  **Описание:** единый список кодов ошибок и единый shape ошибки для всей библиотеки.
  **Что делает:** делает поведение системы предсказуемым и для клиента, и для LLM.
  **Зачем нужна:** если error model не сделать сейчас, потом новые слои будут добавлять ошибки хаотично.
  **Какие части затрагивает:** `contracts`, `server`, `client`
  **Архитектурные нюансы:** сразу заложить коды хотя бы для:
  - invalid input
  - invalid ack
  - invalid event payload
  - unauthorized
  - forbidden
  - connection denied
  - join denied
  - command failed
  - timeout
  - internal error
  **Не забыть обновить:** все следующие фичи, которые добавляют новый тип отказа, должны добавлять новый код или явно переиспользовать существующий.
  **Почему здесь:** чтобы потом не забыть внести security/delivery ошибки в общий список.

### 3.2 Validation error normalization
- [x] **Validation error normalization**
  **Описание:** единая нормализация ошибок схем и payload.
  **Что делает:** превращает Zod/runtime ошибки в стабильный realtime error shape.
  **Зачем нужна:** validation уже есть, теперь нужен единый внешний формат.
  **Какие части затрагивает:** `server`, `client`
  **Архитектурные нюансы:** ошибки validation не должны “протекать” сырьем.
  **Не забыть обновить:** unified error model, чтобы validation ошибки использовали правильные коды.
  **Почему здесь:** это первый реальный consumer unified error model.

---

## 4. Server Runtime

### 4.1 Server runtime core
- [x] **Server runtime core**
  **Описание:** базовый серверный runtime, который знает про registry и умеет исполнять контракты.
  **Что делает:** становится центральной точкой server-side логики.
  **Зачем нужна:** без него все дальше будет набором helper-ов без общей архитектуры.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** runtime должен зависеть от contracts, но не от конкретного транспорта.
  **Не забыть обновить:** registry и общие типы, если понадобятся server-specific runtime types.
  **Почему здесь:** это фундамент серверной части.

### 4.2 Command execution pipeline
- [x] **Command execution pipeline**
  **Описание:** pipeline выполнения команды: validate input → auth/policy → handle → validate ack → normalize errors.
  **Что делает:** делает исполнение команд единообразным.
  **Зачем нужна:** это центр серверной логики.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** pipeline должен быть одной абстракцией, а не цепочкой случайных helper-ов.
  **Не забыть обновить:** unified error model — если добавляется новая стадия с новым типом ошибки, надо обновить error codes.
  **Почему здесь:** command flow — первый важный исполняемый путь.

### 4.3 Event emission pipeline
- [x] **Event emission pipeline**
  **Описание:** pipeline отправки события: validate payload → route → deliver.
  **Что делает:** централизует server push.
  **Зачем нужна:** иначе события будут эмититься хаотично.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** emission должен идти только через contracts, а не через raw event names.
  **Не забыть обновить:** unified error model, если добавляются ошибки доставки/валидации событий.
  **Почему здесь:** после команд нужен единый event flow.

### 4.4 Channel membership runtime
- [x] **Channel membership runtime**
  **Описание:** join/leave логика и хранение membership на сервере.
  **Что делает:** управляет составом каналов/комнат.
  **Зачем нужна:** без membership нет реального realtime по rooms.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** membership должен быть typed и строиться на channel contracts.
  **Не забыть обновить:** unified error model — добавить/использовать коды join/leave ошибок, если еще не сделано.
  **Почему здесь:** это завершает базовый server runtime.

---

## 5. Policy Layer

### 5.1 Policy primitives
- [x] **Realtime policy primitives**
  **Описание:** базовые policy для connect, join, command, receive.
  **Что делает:** задает единый язык прав доступа.
  **Зачем нужна:** доступ нельзя размазывать по handlers.
  **Какие части затрагивает:** `contracts`, `server`
  **Архитектурные нюансы:** policy должна быть маленькой и понятной.
  **Не забыть обновить:** shared type system и unified error model, если появляются новые deny-сценарии.
  **Почему здесь:** сначала нужна сама модель policy.

### 5.2 Policy composition
- [x] **Policy composition helpers**
  **Описание:** `and/or/not` для правил доступа.
  **Что делает:** позволяет собирать сложные проверки из простых.
  **Зачем нужна:** без этого начнется копипаста.
  **Какие части затрагивает:** `contracts`, `server`
  **Архитектурные нюансы:** не делать мини-язык, только несколько combinator-функций.
  **Не забыть обновить:** policy primitives.
  **Почему здесь:** это естественное развитие policy model.

### 5.3 Connection policy enforcement
- [x] **Connection policy enforcement**
  **Описание:** проверка доступа на подключение.
  **Что делает:** не дает неподходящему клиенту открыть realtime session.
  **Зачем нужна:** это первый защитный слой.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** должно быть централизовано в runtime.
  **Не забыть обновить:** unified error model — connection denied должен иметь официальный код.
  **Почему здесь:** connect — самая ранняя точка доступа.

### 5.4 Join policy enforcement
- [x] **Join policy enforcement**
  **Описание:** проверка доступа на вход в канал/комнату.
  **Что делает:** не дает слушать канал без нужных прав.
  **Зачем нужна:** это обязательный слой для rooms/channels.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** join policy не должна жить в handler-е команды.
  **Не забыть обновить:** unified error model — join denied.
  **Почему здесь:** join идет после connect.

### 5.5 Command policy enforcement
- [x] **Command policy enforcement**
  **Описание:** проверка доступа на выполнение команды.
  **Что делает:** не дает вызывать команды без разрешения.
  **Зачем нужна:** это основной command-level security слой.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** это отдельная фаза command pipeline.
  **Не забыть обновить:** unified error model — forbidden/unauthorized command.
  **Почему здесь:** идет после того, как есть готовый pipeline и базовые policies.

### 5.6 Receive policy enforcement
- [x] **Receive policy enforcement**
  **Описание:** проверка права клиента получить событие.
  **Что делает:** не дает событиям утекать подписчикам, которым они не положены.
  **Зачем нужна:** join в канал и право получать конкретное событие — не всегда одно и то же.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** реализуется в delivery/emission слое, а не только через join policy.
  **Не забыть обновить:** unified error model, если хочешь явно различать delivery denied.
  **Почему здесь:** это самая поздняя и тонкая policy-фаза.

---

## 6. Client Runtime

### 6.1 Client runtime core
- [x] **Client runtime core**
  **Описание:** базовый клиентский runtime.
  **Что делает:** становится единым входом для command/subscribe/on.
  **Зачем нужна:** без него клиент будет работать с raw transport API.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** client должен быть store-agnostic.
  **Не забыть обновить:** shared types, unified error model, если клиенту нужен свой слой нормализации ошибок.
  **Почему здесь:** это фундамент клиентской части.

### 6.2 Typed command client API
- [x] **Typed command client API**
  **Описание:** typed отправка команд и получение ack.
  **Что делает:** заменяет raw `emit` на контрактный вызов.
  **Зачем нужна:** это базовый client-to-server flow.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** команды должны отправляться по contract definition, а не по строке.
  **Не забыть обновить:** command contracts и error model, если появляются client-side timeout/failure состояния.
  **Почему здесь:** это первый полезный capability клиента.

### 6.3 Typed channel subscription API
- [x] **Typed channel subscription API**
  **Описание:** typed subscribe/unsubscribe для каналов.
  **Что делает:** убирает хаос из комнат и подписок на клиенте.
  **Зачем нужна:** подписки — базовая часть realtime UI.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** подписка должна идти через channel contract + key contract.
  **Не забыть обновить:** channel contracts, unified error model, если есть subscribe/join failures на клиенте.
  **Почему здесь:** после команд клиент должен уметь подписываться.

### 6.4 Typed event listener API
- [x] **Typed event listener API**
  **Описание:** подписка на конкретные typed events.
  **Что делает:** позволяет получать validated payload без raw listener-ов.
  **Зачем нужна:** это основной consumer-side механизм.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** payload должен валидироваться до пользовательского обработчика.
  **Не забыть обновить:** unified error model для invalid inbound event payload.
  **Почему здесь:** это завершает базовый client runtime.

---

## 7. Delivery & Reliability

### 7.1 Ack handling
- [ ] **Ack handling model**
  **Описание:** единая модель подтверждений команд.
  **Что делает:** делает выполнение команды наблюдаемым и надежным.
  **Зачем нужна:** иначе realtime-команды слишком неявны.
  **Какие части затрагивает:** `contracts`, `server`, `client`
  **Архитектурные нюансы:** ack — часть контракта и часть runtime, не просто callback.
  **Не забыть обновить:** error model — invalid ack / missing ack.
  **Почему здесь:** после базового client/server command flow нужно стабилизировать подтверждения.

### 7.2 Timeout and failure model
- [ ] **Timeout and failure model for commands**
  **Описание:** единая модель timeout и ошибок выполнения команд.
  **Что делает:** задает предсказуемое поведение при неуспешном realtime-вызове.
  **Зачем нужна:** это критично для реального использования.
  **Какие части затрагивает:** `client`, `server`, частично `contracts`
  **Архитектурные нюансы:** timeouts и command failures должны входить в общую error model.
  **Не забыть обновить:** unified error model и typed command client API.
  **Почему здесь:** это следующий логический шаг после ack.

### 7.3 Reconnect-safe resubscription
- [ ] **Reconnect-safe resubscription**
  **Описание:** автоматическое восстановление подписок после reconnect.
  **Что делает:** сохраняет согласованность клиента при нестабильной сети.
  **Зачем нужна:** без этого realtime UX быстро ломается.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** subscription state нужно хранить отдельно от текущей transport session.
  **Не забыть обновить:** error model, если появятся reconnect-specific client states/errors.
  **Почему здесь:** это первый важный reliability слой.

---

## 8. Event-to-State

### 8.1 Event applier abstraction
- [ ] **Event applier abstraction**
  **Описание:** универсальная модель применения события к состоянию.
  **Что делает:** задает единый путь “событие → обновление UI state”.
  **Зачем нужна:** иначе каждый экран будет обрабатывать события вручную и по-разному.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** не привязывать к конкретному store.
  **Не забыть обновить:** typed event listener API, если applier должен интегрироваться с подписками.
  **Почему здесь:** сначала клиент должен уметь получать события.

### 8.2 Event applier registration
- [ ] **Event reducer / applier registration**
  **Описание:** регистрация обработчиков применения событий.
  **Что делает:** связывает event contract с функцией изменения состояния.
  **Зачем нужна:** делает realtime-state flow повторяемым и менее хаотичным.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** регистрация должна идти по event contract, не по строке.
  **Не забыть обновить:** event applier abstraction и docs later.
  **Почему здесь:** это практическая реализация event-to-state слоя.

---

## 9. Transport

### 9.1 Socket.IO server adapter
- [ ] **Socket.IO server adapter**
  **Описание:** первый реальный transport adapter для сервера.
  **Что делает:** связывает server runtime с реальным transport.
  **Зачем нужна:** нужен боевой runtime для MVP.
  **Какие части затрагивает:** `server`
  **Архитектурные нюансы:** адаптер должен быть тонким, без переноса core logic в transport слой.
  **Не забыть обновить:** unified error model, если transport добавляет свои системные ошибки/состояния.
  **Почему здесь:** transport нельзя делать раньше готового runtime.

### 9.2 Socket.IO client adapter
- [ ] **Socket.IO client adapter**
  **Описание:** первый transport adapter для клиента.
  **Что делает:** связывает client runtime с реальным transport.
  **Зачем нужна:** без него клиентская часть не будет реально работать.
  **Какие части затрагивает:** `client`
  **Архитектурные нюансы:** адаптер должен использовать уже готовые typed APIs, а не обходить их.
  **Не забыть обновить:** reconnect model, timeout model, unified error model.
  **Почему здесь:** идет сразу после server adapter-а.

### 9.3 Unified connection context injection
- [ ] **Unified connection context injection**
  **Описание:** единый способ строить connection/session context из transport layer.
  **Что делает:** делает connect, policies и handlers независимыми от конкретного transport API.
  **Зачем нужна:** иначе логика начнет зависеть от Socket.IO specifics.
  **Какие части затрагивает:** `server`, частично `contracts`
  **Архитектурные нюансы:** контекст должен собираться единообразно и попадать в policies/handlers одинаково.
  **Не забыть обновить:** policy primitives и server runtime types, если меняется shape контекста.
  **Почему здесь:** это завершающий слой transport integration.

---

## 10. DX and Project Usability

### 10.1 Strongly typed public API
- [ ] **Strongly typed public API**
  **Описание:** выравнивание и шлифовка публичного TypeScript API после стабилизации runtime.
  **Что делает:** улучшает inference и уменьшает потребность в ручных generic-аннотациях.
  **Зачем нужна:** библиотека должна быть не только правильной, но и удобной.
  **Какие части затрагивает:** `contracts`, `server`, `client`
  **Архитектурные нюансы:** не усложнять типовую систему ради “умности”.
  **Не забыть обновить:** все публичные exports и сигнатуры всех пакетов.
  **Почему здесь:** это лучше делать после стабилизации всех ключевых слоев.

### 10.2 Minimal boilerplate defaults
- [ ] **Minimal boilerplate defaults**
  **Описание:** хорошие defaults для самых частых сценариев.
  **Что делает:** делает правильный путь короче.
  **Зачем нужна:** если API будет слишком многословным, его начнут обходить.
  **Какие части затрагивает:** `contracts`, `server`, `client`
  **Архитектурные нюансы:** defaults должны быть прозрачными, а не магическими.
  **Не забыть обновить:** typed public API и docs later.
  **Почему здесь:** это эргономика поверх уже готового продукта.

### 10.3 Clear developer diagnostics and misuse warnings
- [ ] **Clear developer diagnostics and misuse warnings**
  **Описание:** понятные ошибки и предупреждения для неправильного использования библиотеки.
  **Что делает:** помогает быстрее ловить misuse contracts, subscriptions и runtime ошибок.
  **Зачем нужна:** это особенно полезно для LLM-driven разработки.
  **Какие части затрагивает:** `contracts`, `server`, `client`
  **Архитектурные нюансы:** предупреждения не должны ломать production flow.
  **Не забыть обновить:** unified error model, если warnings/errors оформляются через общий слой.
  **Почему здесь:** diagnostics лучше наводить после того, как финальный API уже стабилен.

---

## 11. Documentation and Local Scripts

### 11.1 Root README
- [ ] **Root README with package map and links**
  **Описание:** один общий README в корне репозитория, который кратко объясняет идею проекта и ведет в документацию конкретных пакетов.
  **Что делает:** дает обзор всего монорепо без дублирования подробной документации в корне.
  **Зачем нужна:** корневой README должен быть короткой входной точкой, а не свалкой всех деталей.
  **Какие части затрагивает:** `docs`
  **Архитектурные нюансы:** в корне не хранить полное API-описание; только overview, package map, quick links, статус пакетов, philosophy.
  **Не забыть обновить:** имена пакетов, public API surface, структуру репозитория.
  **Почему здесь:** корневая документация делается после стабилизации структуры пакетов и публичного API.

### 11.2 Package README generation model
- [ ] **README generation model for `server` and `client` packages**
  **Описание:** единый подход, по которому README каждого пакета генерируется автоматически из публичного API и метаданных.
  **Что делает:** фиксирует, что README не пишется вручную и не попадает в рассинхрон с кодом.
  **Зачем нужна:** ты хочешь, чтобы документация была привязана к конкретному пакету и всегда отражала его реальное API.
  **Какие части затрагивает:** `server`, `client`, `docs`
  **Архитектурные нюансы:** для `contracts` отдельный README не нужен; генерация должна опираться на exports и JSDoc/metadata, а не на ручной markdown.
  **Не забыть обновить:** public exports серверного и клиентского пакета, чтобы генератор видел только официальный API.
  **Почему здесь:** сначала фиксируем модель документации, потом делаем конкретные генераторы.

### 11.3 Generated README for server package
- [ ] **Generated README for `server` package**
  **Описание:** автогенерируемый README для серверного пакета.
  **Что делает:** объясняет серверный runtime, adapters, context, policies, handlers и server-side best practices.
  **Зачем нужна:** серверная часть должна иметь свою самостоятельную документацию рядом с пакетом.
  **Какие части затрагивает:** `server`, `docs`
  **Архитектурные нюансы:** README должен быть обзорным и полезным человеку: что экспортируется, как использовать, best practices, типовые паттерны. Не превращать его в полный dump API.
  **Не забыть обновить:** strong public API, defaults, diagnostics — README должен ссылаться только на реально существующие публичные entrypoints.
  **Почему здесь:** README пакета можно генерировать только после стабилизации server API.

### 11.4 Generated README for client package
- [ ] **Generated README for `client` package**
  **Описание:** автогенерируемый README для клиентского пакета.
  **Что делает:** объясняет client runtime, command API, subscriptions, reconnect и event appliers.
  **Зачем нужна:** клиентская часть тоже должна иметь отдельную и понятную документацию.
  **Какие части затрагивает:** `client`, `docs`
  **Архитектурные нюансы:** README должен быть кратким и практическим, без полного перечисления всех внутренних деталей.
  **Не забыть обновить:** typed event API, reconnect flow, event appliers, defaults.
  **Почему здесь:** это симметричная документация для второго основного пакета.

### 11.5 Full API reference generation model
- [ ] **LLM/API reference generation model**
  **Описание:** единый подход к генерации полного списка всего публичного API для каждого пакета в отдельный файл, пригодный для LLM.
  **Что делает:** задает вторую форму документации: не обзорную README, а полный справочник по API.
  **Зачем нужна:** LLM нужен не красивый README, а максимально полный и прямой список того, что реально можно использовать.
  **Какие части затрагивает:** `server`, `client`, `docs`
  **Архитектурные нюансы:** этот файл должен генерироваться из тех же exports и типов, что и README, но быть более полным и механистичным.
  **Не забыть обновить:** public exports и JSDoc, потому что reference будет строиться по ним.
  **Почему здесь:** сначала фиксируем подход, потом генерируем конкретные файлы.

### 11.6 Generated full API reference for server package
- [ ] **Generated full API reference for `server` package**
  **Описание:** полный автоматически сгенерированный список доступного публичного API серверного пакета.
  **Что делает:** дает LLM и разработчику полный перечень функций, типов и их назначения.
  **Зачем нужна:** это снижает шанс неправильного использования библиотеки моделью.
  **Какие части затрагивает:** `server`, `docs`
  **Архитектурные нюансы:** файл должен быть полным, прямым и машинно-удобным; он не должен заменять README, а дополнять его.
  **Не забыть обновить:** server exports, public types, JSDoc.
  **Почему здесь:** генерация полного API-справочника идет после server README model.

### 11.7 Generated full API reference for client package
- [ ] **Generated full API reference for `client` package**
  **Описание:** полный автоматически сгенерированный список доступного публичного API клиентского пакета.
  **Что делает:** дает LLM и разработчику полный перечень клиентских entrypoints.
  **Зачем нужна:** клиентскую часть особенно важно сделать прозрачной для модели, потому что там много подписок и transport state.
  **Какие части затрагивает:** `client`, `docs`
  **Архитектурные нюансы:** формат должен быть таким же, как у server reference, чтобы не плодить разные mental models.
  **Не забыть обновить:** client exports, public types, JSDoc.
  **Почему здесь:** симметричный шаг для второго пакета.

### 11.8 Internal local script for README generation
- [ ] **Local script for package README generation**
  **Описание:** внутренний скрипт репозитория, который генерирует README для `server` и `client`.
  **Что делает:** автоматизирует создание обзорной документации.
  **Зачем нужна:** README должен быть воспроизводимым и не поддерживаться руками.
  **Какие части затрагивает:** `server`, `client`, `docs`
  **Архитектурные нюансы:** скрипт не должен попадать в npm bundle; это repo-only tooling. Он должен читать публичные exports и metadata.
  **Не забыть обновить:** package exports, file layout, docs paths.
  **Почему здесь:** сам скрипт имеет смысл писать только после того, как понятно, что именно он генерирует.

### 11.9 Internal local script for full API reference generation
- [ ] **Local script for full API reference generation**
  **Описание:** внутренний скрипт репозитория, который генерирует полное описание публичного API для `server` и `client`.
  **Что делает:** производит LLM-friendly файлы со всем доступным API.
  **Зачем нужна:** это твой второй тип документации, отдельный от README.
  **Какие части затрагивает:** `server`, `client`, `docs`
  **Архитектурные нюансы:** скрипт тоже не попадает в npm bundle; он должен опираться на официальный public API, а не на внутренние файлы.
  **Не забыть обновить:** exports, JSDoc, naming conventions, чтобы reference был стабильным.
  **Почему здесь:** после фиксации формата и содержания API reference можно писать генератор.

### 11.10 Documentation regeneration workflow
- [ ] **Documentation regeneration workflow**
  **Описание:** единый workflow обновления root README, package README и full API reference.
  **Что делает:** фиксирует, как именно документация обновляется при изменении API.
  **Зачем нужна:** без этого даже генераторы со временем начнут использоваться хаотично или забываться.
  **Какие части затрагивает:** `server`, `client`, `docs`
  **Архитектурные нюансы:** workflow должен быть простым: один или два repo-level scripts, без попадания в npm bundle.
  **Не забыть обновить:** оба generator scripts и root README links.
  **Почему здесь:** это завершающий шаг документационного слоя.

---

# LiveRail — architecture sketch (updated)

```text
liverail/
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── command/
│   │   │   ├── event/
│   │   │   ├── channel/
│   │   │   ├── policy/
│   │   │   ├── registry/
│   │   │   ├── errors/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── runtime/
│   │   │   ├── pipeline/
│   │   │   ├── policies/
│   │   │   ├── transport/
│   │   │   │   └── socket-io/
│   │   │   ├── context/
│   │   │   ├── errors/
│   │   │   └── index.ts
│   │   ├── README.md              # генерируется скриптом
│   │   ├── LIVERRAIL_API.md       # полный API reference, генерируется скриптом
│   │   └── package.json
│   │
│   ├── client/
│   │   ├── src/
│   │   │   ├── runtime/
│   │   │   ├── commands/
│   │   │   ├── subscriptions/
│   │   │   ├── events/
│   │   │   ├── reconnect/
│   │   │   ├── appliers/
│   │   │   ├── transport/
│   │   │   │   └── socket-io/
│   │   │   ├── errors/
│   │   │   └── index.ts
│   │   ├── README.md              # генерируется скриптом
│   │   ├── LIVERRAIL_API.md       # полный API reference, генерируется скриптом
│   │   └── package.json
│   │
│   └── example-app/
│       ├── server/
│       └── web/
│
├── scripts/
│   ├── generate-package-readmes.ts
│   └── generate-package-api-reference.ts
│
├── README.md                      # общий, короткий, со ссылками на server/client docs
├── pnpm-workspace.yaml
└── package.json

Смысл архитектуры

contracts — общий источник правды
Здесь живут только контракты: команды, события, каналы, policy-примитивы, registry, общие типы и error codes.

server — серверный runtime
Здесь живет исполнение команд, emit событий, membership каналов, policy enforcement, context injection и transport adapter.

client — клиентский runtime
Здесь живут typed commands, подписки, listeners, reconnect, event appliers и transport adapter.

README.md в корне
Только обзор проекта, philosophy, package map и ссылки:

на packages/server/README.md

на packages/client/README.md

README.md внутри server и client
Генерируется автоматически, обзорный, человеко-ориентированный.

LIVERRAIL_API.md внутри server и client
Тоже генерируется автоматически, но это уже полный справочник по публичному API для LLM и точного использования.

scripts/
Это repo-only скрипты генерации документации.
Они не попадают в npm bundle и существуют только для поддержки репозитория.

# Advanced / Future

- [ ] **Store adapters**
  Zustand/Redux/Vue-specific adapters поверх event applier layer.

- [ ] **Machine-readable realtime contract artifact**
  Экспорт contracts в JSON-артефакт для CI, клиента и LLM.

- [ ] **Human-readable contract documentation generator**
  Генерация docs из contract artifact.

- [ ] **CLI for contract export**
  CLI-обертка для export/generate.

- [ ] **Targeted delivery semantics**
  Адресная доставка событий, не только channel broadcast.

- [ ] **Presence-aware policies**
  Политики, учитывающие presence/session state.

- [ ] **Optional response/event caching hooks**
  Кэширование как опциональный extension point.

- [ ] **Realtime performance hooks**
  Метрики latency, delivery timing, join timing.

- [ ] **OpenTelemetry integration**
  Интеграция с observability stack.

- [ ] **Replayable events**
  Повторная доставка/догрузка событий после reconnect.

- [ ] **Idempotent command support**
  Идемпотентные команды и deduplication.

- [ ] **Custom transport adapters**
  Другие транспорты помимо Socket.IO.

- [ ] **Resolver/middleware extensions**
  Расширяемый middleware-слой.

- [ ] **Plugin system**
  Система плагинов для зрелой экосистемы.
