import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что клиентский package README дает практичный обзор runtime,
 * reconnect-поведения, subscriptions и event appliers через официальный API.
 * Это важно, потому что клиентская документация должна быть краткой, но
 * понятной человеку и не должна ссылаться на внутренние implementation-файлы.
 * Также учитываются corner cases с transport boundary: README обязан вести
 * к `@dobrunia-liverail/client` и `@dobrunia-liverail/client/socket-io`, а не к `src/*`.
 */
test("should provide a generated overview README for the client package based on public entrypoints", () => {
  const readme = readFileSync(
    path.resolve(import.meta.dirname, "../README.md"),
    "utf8"
  );

  assert.match(readme, /^# @dobrunia-liverail\/client$/m);
  assert.match(readme, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(readme, /^## Overview$/m);
  assert.match(readme, /^## Public Entry Points$/m);
  assert.match(readme, /^## Core Concepts$/m);
  assert.match(readme, /^## Best Practices$/m);
  assert.match(readme, /`createClientRuntime`/);
  assert.match(readme, /`applyEventApplier`/);
  assert.match(readme, /`eventApplier`/);
  assert.match(readme, /`@dobrunia-liverail\/client\/socket-io`/);
  assert.match(readme, /reconnect/i);
  assert.doesNotMatch(readme, /src\/runtime\/index\.ts/);
  assert.doesNotMatch(readme, /src\/socket-io\/index\.ts/);
});
