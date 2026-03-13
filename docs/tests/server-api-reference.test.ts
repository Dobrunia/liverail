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
 * Проверяет, что полный server API reference покрывает все официальные exports
 * из main entrypoint и Socket.IO subpath, а не только выборочные примеры.
 * Это важно, потому что этот файл нужен и человеку, и LLM как полный справочник
 * по реально доступному публичному API, без обращения к внутренним исходникам.
 * Также учитывается corner case с package boundaries: reference не должен
 * ссылаться на `src/*`, а должен описывать только `@liverail/server` entrypoints.
 */
test("should list every public server export in the generated API reference", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const reference = readFileSync(
    path.resolve(repositoryRoot, "docs/api/server.md"),
    "utf8"
  );
  const mainExports = readExports(
    path.resolve(repositoryRoot, "packages/server/src/index.ts")
  );
  const socketIoExports = readExports(
    path.resolve(repositoryRoot, "packages/server/src/socket-io-entry.ts")
  );

  assert.match(reference, /^# @liverail\/server API Reference$/m);
  assert.match(reference, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(reference, /^## Entrypoint `@liverail\/server`$/m);
  assert.match(reference, /^## Entrypoint `@liverail\/server\/socket-io`$/m);

  for (const exportName of [...mainExports, ...socketIoExports]) {
    assert.match(reference, new RegExp(`\\\`${exportName}\\\``));
  }

  assert.doesNotMatch(reference, /src\/runtime\/index\.ts/);
  assert.doesNotMatch(reference, /src\/socket-io\/index\.ts/);
});
