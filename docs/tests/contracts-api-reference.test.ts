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
 * Проверяет, что полный contracts API reference перечисляет все официальные
 * exports shared entrypoint-а без ссылок на внутренние `src/*` файлы.
 * Это важно, потому что shared package должен иметь такой же полный reference,
 * как client и server, иначе package boundary остается неполной.
 */
test("should list every public contracts export in the generated API reference", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const reference = readFileSync(
    path.resolve(repositoryRoot, "docs/api/contracts.md"),
    "utf8"
  );
  const mainExports = readExports(
    path.resolve(repositoryRoot, "packages/contracts/src/index.ts")
  );

  assert.match(reference, /^# dobrunia-liverail-contracts API Reference$/m);
  assert.match(reference, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(reference, /^## Entrypoint `dobrunia-liverail-contracts`$/m);

  for (const exportName of mainExports) {
    assert.match(reference, new RegExp(`\\\`${exportName}\\\``));
  }

  assert.doesNotMatch(reference, /src\/index\.ts/);
});
