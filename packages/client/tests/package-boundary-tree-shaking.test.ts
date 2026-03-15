import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что main entrypoint клиентского пакета не тянет Socket.IO adapter
 * и что transport-specific код вынесен в отдельный subpath export.
 * Это важно, потому что импорт `dobrunia-liverail-client` не должен принуждать
 * browser bundle тащить `socket.io-client`, если используется другой transport.
 * Также покрывается corner case с dependency policy, чтобы socket client
 * оставался optional peer, а не обязательной зависимостью основного пакета.
 */
test("should isolate the client Socket.IO adapter behind a dedicated subpath export", () => {
  const packageJson = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../package.json"),
      "utf8"
    )
  ) as {
    readonly exports: Record<string, unknown>;
    readonly dependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly sideEffects?: boolean;
  };
  const mainEntry = readFileSync(
    path.resolve(import.meta.dirname, "../src/index.ts"),
    "utf8"
  );

  assert.equal(packageJson.sideEffects, false);
  assert.deepEqual(Object.keys(packageJson.exports), [".", "./socket-io"]);
  assert.equal(packageJson.dependencies?.["socket.io-client"], undefined);
  assert.equal(packageJson.peerDependencies?.["socket.io-client"], "^4.8.3");
  assert.doesNotMatch(mainEntry, /createSocketIoClientTransport/);
  assert.doesNotMatch(mainEntry, /SOCKET_IO_COMMAND_EVENT/);
});
