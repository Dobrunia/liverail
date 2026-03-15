import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что package README для contracts дает обзор shared contract слоя
 * через публичный entrypoint и не ссылается на внутреннюю структуру исходников.
 * Это важно, потому что shared boundary публикуется как отдельный пакет и не
 * должен оставаться без consumer-facing README на фоне client/server пакетов.
 */
test("should provide a generated overview README for the contracts package based on the public entrypoint", () => {
  const readme = readFileSync(
    path.resolve(import.meta.dirname, "../README.md"),
    "utf8"
  );

  assert.match(readme, /^# @dobrunia-liverail\/contracts$/m);
  assert.match(readme, /^> Generated file\. Do not edit manually\.$/m);
  assert.match(readme, /^## Overview$/m);
  assert.match(readme, /^## Public Entry Points$/m);
  assert.match(readme, /^## Core Concepts$/m);
  assert.match(readme, /^## Best Practices$/m);
  assert.match(readme, /`createContractRegistry`/);
  assert.match(readme, /`command`/);
  assert.match(readme, /`receivePolicy`/);
  assert.match(readme, /registry/i);
  assert.doesNotMatch(readme, /src\/index\.ts/);
});
