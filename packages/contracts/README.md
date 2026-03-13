# @liverail/contracts

> Generated file. Do not edit manually.

## Overview

Shared contract layer for commands, events, channels, policies, validation and registry composition.

## Public Entry Points

- `@liverail/contracts`: `REALTIME_ERROR_CODES`, `REALTIME_VALIDATION_ERROR_CODES`, `LiveRailRealtimeError`, `createRealtimeError`, `isRealtimeError`, `isRealtimeValidationError`, `normalizeValidationError`, `voidSchema`, `SYSTEM_EVENT_NAMES`, `createSystemEvent`, `isSystemEventName`, `COMMAND_ACK_STATUSES`, `COMMAND_RESULT_STATUSES`, `command`, `parseCommandAck`, `parseCommandInput`, `event`, `parseEventPayload`, `channel`, `createChannelInstance`, `isSameChannelInstance`, `parseChannelInstance`, `parseChannelKey`, `stringifyChannelInstance`, `POLICY_SCOPES`, `andPolicy`, `commandPolicy`, `connectPolicy`, `joinPolicy`, `notPolicy`, `orPolicy`, `policy`, `receivePolicy`, `createContractRegistry`, `defineChannels`, `defineCommands`, `defineEvents`, `definePolicies`, `inspectContractRegistry`

## Core Concepts

- Contract Primitives: Define commands, events and channels from one typed contract surface.
- Validation and Errors: Normalize validation and runtime failures into one transport-safe realtime error model.
- Policies: Compose access-control and delivery rules with explicit policy contracts.
- Registry and Introspection: Group public contracts into a single registry and inspect it without reaching into package internals.

## Best Practices

- Keep shared schemas and contract names in this package so client and server stay aligned.
- Prefer the normalized realtime error helpers over ad-hoc transport-specific error payloads.
- Build one explicit contract registry per application boundary instead of importing random primitives at runtime.

## Links

- [Documentation Hub](../../docs/README.md)
- [Root README](../../README.md)
