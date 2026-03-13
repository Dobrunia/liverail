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
 * package README именно для `server` и `client`, а не набор ручных markdown-
 * соглашений, разбросанных по файлам.
 * Это важно, потому что дальше README должны собираться воспроизводимо из
 * официального public API и metadata, без случайного захвата внутренних файлов.
 * Также учитывается corner case с `contracts`: этот пакет должен остаться вне
 * модели package README, потому что для него отдельный пакетный README не нужен.
 */
test("should define a machine-readable README generation model for the server and client packages", () => {
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
    "@liverail/server",
    "@liverail/client"
  ]);
  assert.deepEqual(model.packages["@liverail/server"], {
    packageJsonPath: "packages/server/package.json",
    outputPath: "packages/server/README.md",
    sourceEntrypoints: [
      "packages/server/src/index.ts",
      "packages/server/src/socket-io-entry.ts"
    ],
    entryExportPaths: [".", "./socket-io"],
    metadataPath: "docs/metadata/server.package-readme.json"
  });
  assert.deepEqual(model.packages["@liverail/client"], {
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
