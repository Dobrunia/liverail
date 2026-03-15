import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";

import { test } from "vitest";

/**
 * Проверяет, что `dobrunia-liverail-contracts` dry-run pack действительно включает
 * package README в tarball, а не оставляет publish artifact без базовой docs.
 * Это важно, потому что документация должна сопровождать именно публикуемый
 * пакет, а не только жить в репозитории.
 */
test("should include the generated contracts README in the npm pack artifact", () => {
  const packageRoot = path.resolve(import.meta.dirname, "..");
  const packOutput = execSync("npm pack --dry-run --json", {
    cwd: packageRoot,
    encoding: "utf8"
  });
  const parsed = JSON.parse(packOutput) as Array<{
    readonly files?: Array<{
      readonly path?: string;
    }>;
  }>;
  const packedFiles = parsed[0]?.files?.map((file) => file.path) ?? [];

  assert.ok(packedFiles.includes("README.md"));
});
