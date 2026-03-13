import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что `contracts` остается легким shared-пакетом без transport-
 * специфичных зависимостей и side effects на уровне package boundary.
 * Это важно, потому что этот пакет должен безопасно использоваться и в
 * браузере, и на сервере как общий слой контрактов без лишнего runtime-кода.
 * Также покрывается corner case с package exports, чтобы contracts не
 * публиковал лишние entrypoints и оставался предсказуемым для bundler-ов.
 */
test("should keep the contracts package transport-agnostic and side-effect free", () => {
  const packageJson = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../package.json"),
      "utf8"
    )
  ) as {
    readonly exports: Record<string, unknown>;
    readonly dependencies?: Record<string, string>;
    readonly sideEffects?: boolean;
  };

  assert.equal(packageJson.sideEffects, false);
  assert.deepEqual(Object.keys(packageJson.exports), ["."]);
  assert.equal(packageJson.dependencies?.["socket.io"], undefined);
  assert.equal(packageJson.dependencies?.["socket.io-client"], undefined);
});
