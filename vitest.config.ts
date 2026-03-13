import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/**
 * Общий Vitest-конфиг для workspace-пакетов.
 * Алиасы ведут тесты на исходники пакетов, а не на случайно устаревший dist.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@liverail/client": resolve(rootDir, "packages/client/src/index.ts"),
      "@liverail/contracts": resolve(rootDir, "packages/contracts/src/index.ts"),
      "@liverail/server": resolve(rootDir, "packages/server/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["packages/*/tests/**/*.test.ts"]
  }
});
