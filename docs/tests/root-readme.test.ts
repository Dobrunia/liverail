import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что корневой README остается короткой входной точкой в монорепо,
 * а не превращается в свалку API-деталей и случайных примеров.
 * Это важно, потому что обзор проекта должен быстро объяснять назначение
 * пакетов и вести дальше в пакетную документацию, не дублируя ее целиком.
 * Также учитывается corner case со структурой репозитория: ссылки должны
 * указывать на реально существующий docs-хаб и на актуальные package paths.
 */
test("should keep the root README as a short monorepo entrypoint with package links", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const readmePath = path.resolve(repositoryRoot, "README.md");
  const docsHubPath = path.resolve(repositoryRoot, "docs/README.md");
  const readme = readFileSync(readmePath, "utf8");

  assert.ok(existsSync(docsHubPath));
  assert.match(readme, /^# LiveRail/m);
  assert.match(readme, /^## Overview$/m);
  assert.match(readme, /^## Package Map$/m);
  assert.match(readme, /^## Quick Links$/m);
  assert.match(readme, /\[dobrunia-liverail-contracts\]\(\.\/packages\/contracts\)/);
  assert.match(readme, /\[dobrunia-liverail-server\]\(\.\/packages\/server\)/);
  assert.match(readme, /\[dobrunia-liverail-client\]\(\.\/packages\/client\)/);
  assert.match(readme, /\[Documentation Hub\]\(\.\/docs\/README\.md\)/);
  assert.doesNotMatch(readme, /^## API Reference$/m);
});
