# @dobrunia-liverail/client

> Generated file. Do not edit manually.

## Overview

Client runtime for typed commands, subscriptions and reconnect-safe event flow.

## Public Entry Points

- `@dobrunia-liverail/client`: `createClientRuntime`, `applyEventApplier`, `eventApplier`
- `@dobrunia-liverail/client/socket-io`: `SOCKET_IO_CHANNEL_JOIN_EVENT`, `SOCKET_IO_CHANNEL_LEAVE_EVENT`, `SOCKET_IO_COMMAND_EVENT`, `createSocketIoClientTransport`

## Core Concepts

- Client Runtime: Create a typed client runtime around the shared contract registry.
- Command API: Execute commands with validation, timeout handling and normalized failures.
- Subscriptions and Events: Subscribe to channel instances and handle validated inbound events.
- Reconnect and State Updates: Keep subscriptions and event appliers stable across reconnect and transport changes.

## Best Practices

- Build the runtime from contracts first and then plug in a transport implementation.
- Use event appliers for state transitions before listener-specific side effects.
- Listen to lifecycle and system events instead of inferring transport state manually.

## Links

- [Documentation Hub](../../docs/README.md)
- [Root README](../../README.md)
