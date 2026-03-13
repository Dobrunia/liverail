# LiveRail

Core entrypoints are transport-agnostic:

```ts
import { createClientRuntime } from "@liverail/client";
import { createServerRuntime } from "@liverail/server";
```

Socket.IO adapters are published as dedicated subpath exports so main packages stay tree-shakable:

```ts
import { createSocketIoClientTransport } from "@liverail/client/socket-io";
import { createSocketIoServerAdapter } from "@liverail/server/socket-io";
```
