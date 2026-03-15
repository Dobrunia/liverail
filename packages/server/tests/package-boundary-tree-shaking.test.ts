import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что main entrypoint серверного пакета не смешивает core runtime
 * с Socket.IO adapter-ом и что transport-интеграция вынесена в subpath export.
 * Это важно, потому что импорт `dobrunia-liverail-server` должен оставаться core-only
 * и не тянуть transport dependency без явного запроса пользователя.
 * Также покрывается corner case с dependency policy, чтобы `socket.io`
 * оставался optional peer вокруг отдельного adapter entrypoint.
 */
test("should isolate the server Socket.IO adapter behind a dedicated subpath export", () => {
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
  assert.equal(packageJson.dependencies?.["socket.io"], undefined);
  assert.equal(packageJson.peerDependencies?.["socket.io"], "^4.8.3");
  assert.doesNotMatch(mainEntry, /createSocketIoServerAdapter/);
  assert.doesNotMatch(mainEntry, /SOCKET_IO_COMMAND_EVENT/);
});
