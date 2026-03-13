import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

type ApiReferenceGenerationModel = {
  readonly kind: string;
  readonly version: number;
  readonly sources: {
    readonly publicApi: string;
    readonly types: string;
    readonly metadata: string;
  };
  readonly format: {
    readonly style: string;
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  };
  readonly packages: Record<
    string,
    {
      readonly packageJsonPath: string;
      readonly outputPath: string;
      readonly sourceEntrypoints: readonly string[];
      readonly entryExportPaths: readonly string[];
      readonly metadataPath: string;
    }
  >;
};

/**
 * Проверяет, что для полного API-справочника есть отдельная machine-readable
 * модель, а не неявная договоренность "как-нибудь собрать markdown потом".
 * Это важно, потому что LLM-friendly reference должен строиться из тех же
 * официальных exports и JSDoc, что и package README, но в более полном формате.
 * Также покрывается corner case со стабильностью формата: обе пакетные схемы
 * должны использовать одинаковый output style и не включать внутренние файлы.
 */
test("should define a machine-readable full API reference generation model for server and client", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const model = JSON.parse(
    readFileSync(
      path.resolve(repositoryRoot, "docs/models/api-reference-generation.json"),
      "utf8"
    )
  ) as ApiReferenceGenerationModel;

  assert.equal(model.kind, "full-api-reference-generation-model");
  assert.equal(model.version, 1);
  assert.deepEqual(model.sources, {
    publicApi: "package-exports",
    types: "entrypoint-jsdoc",
    metadata: "docs-metadata"
  });
  assert.deepEqual(model.format, {
    style: "llm-friendly-markdown",
    include: ["functions", "types", "subpath-exports"],
    exclude: ["internal-files", "tests", "types-directories"]
  });
  assert.deepEqual(Object.keys(model.packages), [
    "@liverail/server",
    "@liverail/client"
  ]);
  assert.deepEqual(model.packages["@liverail/server"], {
    packageJsonPath: "packages/server/package.json",
    outputPath: "docs/api/server.md",
    sourceEntrypoints: [
      "packages/server/src/index.ts",
      "packages/server/src/socket-io-entry.ts"
    ],
    entryExportPaths: [".", "./socket-io"],
    metadataPath: "docs/metadata/server.api-reference.json"
  });
  assert.deepEqual(model.packages["@liverail/client"], {
    packageJsonPath: "packages/client/package.json",
    outputPath: "docs/api/client.md",
    sourceEntrypoints: [
      "packages/client/src/index.ts",
      "packages/client/src/socket-io-entry.ts"
    ],
    entryExportPaths: [".", "./socket-io"],
    metadataPath: "docs/metadata/client.api-reference.json"
  });
});
