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
      "@liverail/client/socket-io": resolve(rootDir, "packages/client/src/socket-io-entry.ts"),
      "@liverail/client": resolve(rootDir, "packages/client/src/index.ts"),
      "@liverail/contracts": resolve(rootDir, "packages/contracts/src/index.ts"),
      "@liverail/server/socket-io": resolve(rootDir, "packages/server/src/socket-io-entry.ts"),
      "@liverail/server": resolve(rootDir, "packages/server/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: [
      "packages/*/tests/**/*.test.ts",
      "docs/tests/**/*.test.ts",
      "scripts/tests/**/*.test.ts",
      "example-app/tests/**/*.test.ts"
    ]
  }
});
