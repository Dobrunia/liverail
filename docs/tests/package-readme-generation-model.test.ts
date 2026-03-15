import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

type ReadmeGenerationModel = {
  readonly kind: string;
  readonly version: number;
  readonly sources: {
    readonly publicApi: string;
    readonly types: string;
    readonly metadata: string;
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
 * Проверяет, что в репозитории есть единая machine-readable модель генерации
 * package README для всех трех публичных пакетов, а не набор ручных markdown-
 * соглашений, разбросанных по файлам.
 * Это важно, потому что дальше README должны собираться воспроизводимо из
 * официального public API и metadata, без случайного захвата внутренних файлов.
 * Также учитывается corner case с shared boundary: `contracts` должен идти
 * через тот же генератор, чтобы publishable пакет не оставался без README.
 */
test("should define a machine-readable README generation model for every public package", () => {
  const repositoryRoot = path.resolve(import.meta.dirname, "../..");
  const model = JSON.parse(
    readFileSync(
      path.resolve(repositoryRoot, "docs/models/package-readme-generation.json"),
      "utf8"
    )
  ) as ReadmeGenerationModel;

  assert.equal(model.kind, "package-readme-generation-model");
  assert.equal(model.version, 1);
  assert.deepEqual(model.sources, {
    publicApi: "package-exports",
    types: "entrypoint-jsdoc",
    metadata: "docs-metadata"
  });
  assert.deepEqual(Object.keys(model.packages), [
    "dobrunia-liverail-contracts",
    "dobrunia-liverail-server",
    "dobrunia-liverail-client"
  ]);
  assert.deepEqual(model.packages["dobrunia-liverail-contracts"], {
    packageJsonPath: "packages/contracts/package.json",
    outputPath: "packages/contracts/README.md",
    sourceEntrypoints: [
      "packages/contracts/src/index.ts"
    ],
    entryExportPaths: ["."],
    metadataPath: "docs/metadata/contracts.package-readme.json"
  });
  assert.deepEqual(model.packages["dobrunia-liverail-server"], {
    packageJsonPath: "packages/server/package.json",
    outputPath: "packages/server/README.md",
    sourceEntrypoints: [
      "packages/server/src/index.ts",
      "packages/server/src/socket-io-entry.ts"
    ],
    entryExportPaths: [".", "./socket-io"],
    metadataPath: "docs/metadata/server.package-readme.json"
  });
  assert.deepEqual(model.packages["dobrunia-liverail-client"], {
    packageJsonPath: "packages/client/package.json",
    outputPath: "packages/client/README.md",
    sourceEntrypoints: [
      "packages/client/src/index.ts",
      "packages/client/src/socket-io-entry.ts"
    ],
    entryExportPaths: [".", "./socket-io"],
    metadataPath: "docs/metadata/client.package-readme.json"
  });
});
