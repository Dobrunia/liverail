import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что серверный package README действительно обзорный и привязан
 * к официальному публичному API, а не к внутренней структуре исходников.
 * Это важно, потому что README должен объяснять runtime, context, policies
 * и transport entrypoints рядом с пакетом, не превращаясь в dump всех типов.
 * Также учитываются corner cases с package boundaries: README обязан ссылаться
 * только на `dobrunia-liverail-server` и `dobrunia-liverail-server/socket-io`, а не на `src/*`.
 */
test("should provide a generated overview README for the server package based on public entrypoints", () => {
  const readme = readFileSync(
    path.resolve(import.meta.dirname, "../README.md"),
    "utf8"
  );

  assert.match(readme, /^# dobrunia-liverail-server$/m);
  assert.match(readme, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(readme, /^## Overview$/m);
  assert.match(readme, /^## Public Entry Points$/m);
  assert.match(readme, /^## Core Concepts$/m);
  assert.match(readme, /^## Best Practices$/m);
  assert.match(readme, /`createServerRuntime`/);
  assert.match(readme, /`defineServerRuntime`/);
  assert.match(readme, /`createServerRuntimeContext`/);
  assert.match(readme, /`dobrunia-liverail-server\/socket-io`/);
  assert.match(readme, /lifecycle hooks/i);
  assert.doesNotMatch(readme, /src\/runtime\/index\.ts/);
  assert.doesNotMatch(readme, /src\/socket-io\/index\.ts/);
});
