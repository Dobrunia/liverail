# dobrunia-liverail-server

> Generated file. Do not edit manually.

## Overview

Server runtime for contract-driven realtime applications.

## Public Entry Points

- `dobrunia-liverail-server`: `createServerRuntime`, `defineServerRuntime`, `createServerRuntimeContext`
- `dobrunia-liverail-server/socket-io`: `SOCKET_IO_CHANNEL_JOIN_EVENT`, `SOCKET_IO_CHANNEL_LEAVE_EVENT`, `SOCKET_IO_COMMAND_EVENT`, `createSocketIoChannelRoute`, `createSocketIoEventDeliverer`, `createSocketIoServerAdapter`, `createSocketIoSocketRoute`, `getSocketIoChannelRoom`

## Core Concepts

- Core Runtime: Create a typed server runtime around the contract registry.
- Connection Context: Inject request-specific context for handlers, policies and lifecycle hooks.
- Policies and Handlers: Keep command, connection, join and receive decisions explicit and typed.
- Transport Adapters: Expose transport-specific integrations through dedicated public subpath exports.

## Best Practices

- Keep the root runtime transport-agnostic and wire adapters through explicit entrypoints.
- Prefer context injection and policies over ad-hoc checks inside handlers.
- Treat lifecycle hooks as operational extension points, not as a plugin system.

## Links

- [Documentation Hub](../../docs/README.md)
- [Root README](../../README.md)
