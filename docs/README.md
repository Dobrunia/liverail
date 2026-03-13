# LiveRail Documentation

## Overview

This directory is the documentation hub for package-level guides and generated API reference files.
The root README only explains the repository at a high level and links here.

## Package Documentation Map

- `@liverail/contracts`: [package README](../packages/contracts/README.md) and [API reference](./api/contracts.md).
- `@liverail/server`: [package README](../packages/server/README.md) and [API reference](./api/server.md).
- `@liverail/client`: [package README](../packages/client/README.md) and [API reference](./api/client.md).

## Repository Links

- [Root README](../README.md)
- [Server Package](../packages/server)
- [Client Package](../packages/client)
- [Contracts Package](../packages/contracts)

## Regeneration Workflow

- Run `npm run docs:generate` to regenerate package README files and full API reference files.
- Run `npm run docs:readmes` when only package overview README files changed.
- Run `npm run docs:api` when only full API reference files changed.
- Review [Root README](../README.md) after package map or public entrypoint changes, because the root overview stays intentionally manual.
