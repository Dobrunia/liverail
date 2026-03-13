import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

import { generateApiReferences } from "../src/api-reference-generator.mjs";

/**
 * Проверяет, что локальный генератор полного API reference воспроизводит
 * текущие файлы `docs/api/*.md` из общей модели и официальных exports.
 * Это важно, потому что reference должен оставаться полным и машинно-удобным,
 * а не редактироваться руками после каждого изменения публичного API.
 * Также учитывается corner case с package boundaries: генератор читает
 * entrypoints и metadata репозитория, но не зависит от `dist` и npm bundle.
 */
test("should generate full API reference files from the public export model", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const generated = generateApiReferences({ repositoryRoot });

  assert.equal(generated.length, 2);

  for (const entry of generated) {
    const currentContent = readFileSync(
      path.resolve(repositoryRoot, entry.outputPath),
      "utf8"
    );

    assert.equal(entry.content, currentContent);
  }
});
