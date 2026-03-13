import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что workflow регенерации документации зафиксирован на уровне
 * корня репозитория и сводится к нескольким явным repo-only scripts.
 * Это важно, потому что генераторы без понятной точки входа быстро забываются
 * и документация снова начинает расходиться с публичным API пакетов.
 * Также учитывается corner case со связностью документации: docs hub должен
 * прямо объяснять, какой командой обновлять root README и generated файлы.
 */
test("should define a simple root-level documentation regeneration workflow", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const packageJson = JSON.parse(
    readFileSync(path.resolve(repositoryRoot, "package.json"), "utf8")
  ) as {
    readonly scripts: Record<string, string>;
  };
  const docsHub = readFileSync(
    path.resolve(repositoryRoot, "docs/README.md"),
    "utf8"
  );

  assert.equal(
    packageJson.scripts["docs:readmes"],
    "node ./scripts/generate-package-readmes.mjs"
  );
  assert.equal(
    packageJson.scripts["docs:api"],
    "node ./scripts/generate-api-references.mjs"
  );
  assert.equal(
    packageJson.scripts["docs:generate"],
    "npm run docs:readmes && npm run docs:api"
  );
  assert.match(docsHub, /^## Regeneration Workflow$/m);
  assert.match(docsHub, /`npm run docs:generate`/);
});
