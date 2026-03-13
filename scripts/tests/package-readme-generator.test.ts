import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

import { generatePackageReadmes } from "../src/package-readme-generator.mjs";

/**
 * Проверяет, что локальный генератор package README воспроизводит уже
 * зафиксированные README для `server` и `client` из machine-readable модели.
 * Это важно, потому что обзорная документация не должна поддерживаться руками
 * и не должна расходиться с public exports и metadata между релизами.
 * Также учитывается corner case с repo-only tooling: генератор работает по
 * путям монорепозитория и пишет в package README, а не в npm bundle артефакты.
 */
test("should generate package READMEs from the public export model and metadata", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const generated = generatePackageReadmes({ repositoryRoot });

  assert.equal(generated.length, 2);

  for (const entry of generated) {
    const currentContent = readFileSync(
      path.resolve(repositoryRoot, entry.outputPath),
      "utf8"
    );

    assert.equal(entry.content, currentContent);
  }
});
