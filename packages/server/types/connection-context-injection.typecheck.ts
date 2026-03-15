import { createServer } from "node:http";

import { Server as SocketIoServer } from "socket.io";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry
} from "dobrunia-liverail-contracts";
import {
  createServerRuntime,
  createServerRuntimeContext,
  type ServerRuntimeContext
} from "../src/index.js";
import { createSocketIoServerAdapter } from "../src/socket-io-entry.js";

/**
 * Проверяет на уровне типов, что unified connection context может быть собран
 * в transport layer один раз и затем без cast-ов использоваться в policies,
 * handlers и channel runtime как единый typed shape.
 * Это важно, потому что transport integration должна стабилизировать форму
 * контекста для всего server runtime, а не оставлять ее произвольным `unknown`.
 * Также покрывается corner case с helper-ом `createServerRuntimeContext`, чтобы
 * transport adapter мог собирать официальный context shape детерминированно.
 */
const inspectContext = command("inspect-context", {
  input: z.void(),
  ack: z.object({
    connectionId: z.string(),
    userId: z.string()
  })
});
const voiceRoom = channel("voice-room", {
  key: z.object({
    roomId: z.string()
  })
});
type SocketIoRuntimeContext = ServerRuntimeContext<
  { tenantId: string },
  { id: string },
  { ip: string },
  "socket.io"
>;

const context = createServerRuntimeContext({
  connectionId: "socket-1",
  transport: "socket.io" as const,
  session: {
    tenantId: "tenant-1"
  },
  user: {
    id: "user-1"
  },
  metadata: {
    ip: "127.0.0.1"
  }
});
const runtime = createServerRuntime<SocketIoRuntimeContext>({
  registry: createContractRegistry({
    commands: [inspectContext] as const,
    channels: [voiceRoom] as const
  }),
  commandHandlers: {
    "inspect-context": ({ context: runtimeContext }) => ({
      connectionId: runtimeContext.connection.id,
      userId: runtimeContext.user.id
    })
  },
  channelJoinAuthorizers: {
    "voice-room": ({ context: runtimeContext }) =>
      runtimeContext.session.tenantId.length > 0 &&
      runtimeContext.metadata.ip.length > 0
  }
});
const io = new SocketIoServer(createServer());
const adapter = createSocketIoServerAdapter({
  io,
  runtime,
  injectContext(socket) {
    return {
      session: {
        tenantId: String(socket.handshake.auth.tenantId ?? "")
      },
      user: {
        id: String(socket.handshake.auth.userId ?? "")
      },
      metadata: {
        ip: String(socket.handshake.address)
      }
    };
  }
});

context.connection.transport;
adapter.commandEvent;
adapter.joinEvent;
adapter.leaveEvent;

type ShouldReturnUnifiedRuntimeContext = Assert<
  IsEqual<typeof context, SocketIoRuntimeContext>
>;

type ShouldExposeAdapterDispose = Assert<
  IsEqual<typeof adapter.dispose, () => void>
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
