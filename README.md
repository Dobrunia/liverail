# LiveRail

## Overview

LiveRail is a contract-driven realtime monorepo for web applications.
It splits the system into a shared contract layer, a server runtime and a client runtime,
so commands, events, channels and lifecycle behavior stay explicit and typed.

## Package Map

| Package | Role | Status |
| --- | --- | --- |
| [@dobrunia-liverail/contracts](./packages/contracts) | Shared contracts, validation, errors and registry primitives | Shared foundation |
| [@dobrunia-liverail/server](./packages/server) | Server runtime, policies, lifecycle hooks and transport adapters | Runtime package |
| [@dobrunia-liverail/client](./packages/client) | Client runtime, subscriptions, reconnect flow and event appliers | Runtime package |

## Quick Links

- [Documentation Hub](./docs/README.md)
- [Documentation Workflow](./docs/README.md#regeneration-workflow)
- [Feature Plan](./features.md)
- [Server Package](./packages/server)
- [Client Package](./packages/client)
- [Contracts Package](./packages/contracts)

## Philosophy

The root README stays intentionally short.
Package-specific behavior, usage guides and generated API documentation live outside the repository root.
