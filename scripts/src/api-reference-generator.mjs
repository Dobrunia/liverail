import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPackageExports,
  describeEntrypointExports,
  formatBulletList,
  readJsonFile,
  resolveRepositoryPath,
  toPackageImportPath
} from "./shared/doc-generation.mjs";

const DEFAULT_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);

/**
 * Собирает полный LLM-friendly API reference для `server` и `client`
 * из общей модели, официальных exports и JSDoc публичных деклараций.
 */
export function generateApiReferences(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const model = readJsonFile(
    resolveRepositoryPath(
      repositoryRoot,
      "docs/models/api-reference-generation.json"
    )
  );
  const generated = [];

  for (const [packageName, definition] of Object.entries(model.packages)) {
    const packageJson = readJsonFile(
      resolveRepositoryPath(repositoryRoot, definition.packageJsonPath)
    );
    const metadata = readJsonFile(
      resolveRepositoryPath(repositoryRoot, definition.metadataPath)
    );
    const entrypoints = definition.entryExportPaths.map((exportPath, index) => ({
      importPath: toPackageImportPath(packageName, exportPath),
      exports: describeEntrypointExports(
        resolveRepositoryPath(repositoryRoot, definition.sourceEntrypoints[index]),
        repositoryRoot
      )
    }));

    assertPackageExports(packageJson, definition.entryExportPaths, packageName);

    generated.push({
      packageName,
      outputPath: definition.outputPath,
      content: createApiReference({
        entrypoints,
        metadata
      })
    });
  }

  return generated;
}

/**
 * Записывает сгенерированные API reference файлы в `docs/api`.
 */
export function writeApiReferences(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const generated = generateApiReferences({ repositoryRoot });

  for (const entry of generated) {
    writeFileSync(
      resolveRepositoryPath(repositoryRoot, entry.outputPath),
      entry.content
    );
  }

  return generated;
}

function createApiReference({ entrypoints, metadata }) {
  const sections = [];

  for (const entrypoint of entrypoints) {
    const values = entrypoint.exports.filter((item) => item.kind === "value");
    const types = entrypoint.exports.filter((item) => item.kind === "type");

    sections.push(
      `## Entrypoint \`${entrypoint.importPath}\``,
      "",
      "### Values",
      "",
      values.length === 0
        ? "None."
        : formatBulletList(
            values.map(
              (item) => `\`${item.name}\`: ${item.description}`
            )
          ),
      "",
      "### Types",
      "",
      types.length === 0
        ? "None."
        : formatBulletList(
            types.map(
              (item) => `\`${item.name}\`: ${item.description}`
            )
          ),
      ""
    );
  }

  return [
    `# ${metadata.title}`,
    "",
    "> Generated file. Do not edit manually.",
    "",
    "## Scope",
    "",
    metadata.summary,
    "",
    ...sections
  ].join("\n");
}
