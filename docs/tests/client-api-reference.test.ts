import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

function readExports(sourcePath: string): string[] {
  const source = readFileSync(sourcePath, "utf8");
  const matches = source.matchAll(/export(?: type)?\s*\{([\s\S]*?)\}\s*from/g);
  const names = new Set<string>();

  for (const match of matches) {
    const body = match[1] ?? "";
    for (const item of body.split(",")) {
      const normalized = item.trim().replace(/\s+as\s+.+$/, "");

      if (normalized.length > 0) {
        names.add(normalized);
      }
    }
  }

  return [...names].sort();
}

/**
 * Проверяет, что полный client API reference перечисляет все официальные
 * exports из core entrypoint и Socket.IO subpath без пропусков и сокращений.
 * Это важно, потому что клиентский runtime содержит много transport и
 * subscription-сущностей, и LLM-friendly reference должен отражать их полностью.
 * Также покрывается corner case с package boundaries: reference описывает только
 * публичные `dobrunia-liverail-client` entrypoints и не ссылается на внутренние `src/*`.
 */
test("should list every public client export in the generated API reference", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const reference = readFileSync(
    path.resolve(repositoryRoot, "docs/api/client.md"),
    "utf8"
  );
  const mainExports = readExports(
    path.resolve(repositoryRoot, "packages/client/src/index.ts")
  );
  const socketIoExports = readExports(
    path.resolve(repositoryRoot, "packages/client/src/socket-io-entry.ts")
  );

  assert.match(reference, /^# dobrunia-liverail-client API Reference$/m);
  assert.match(reference, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(reference, /^## Entrypoint `dobrunia-liverail-client`$/m);
  assert.match(reference, /^## Entrypoint `dobrunia-liverail-client\/socket-io`$/m);

  for (const exportName of [...mainExports, ...socketIoExports]) {
    assert.match(reference, new RegExp(`\\\`${exportName}\\\``));
  }

  assert.doesNotMatch(reference, /src\/runtime\/index\.ts/);
  assert.doesNotMatch(reference, /src\/socket-io\/index\.ts/);
});
