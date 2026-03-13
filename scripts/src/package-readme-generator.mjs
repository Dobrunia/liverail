import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPackageExports,
  formatBulletList,
  readEntrypointExports,
  readJsonFile,
  resolveRepositoryPath,
  toPackageImportPath
} from "./shared/doc-generation.mjs";

const DEFAULT_REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL("../..", import.meta.url))
);

/**
 * Собирает воспроизводимые package README для `server` и `client` из общей
 * machine-readable модели, metadata и официальных public entrypoints.
 */
export function generatePackageReadmes(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const model = readJsonFile(
    resolveRepositoryPath(
      repositoryRoot,
      "docs/models/package-readme-generation.json"
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
    const publicEntrypoints = definition.entryExportPaths.map((exportPath, index) => {
      const entrypointExports = readEntrypointExports(
        resolveRepositoryPath(repositoryRoot, definition.sourceEntrypoints[index])
      );

      return {
        importPath: toPackageImportPath(packageName, exportPath),
        values: entrypointExports.values
      };
    });

    assertPackageExports(packageJson, definition.entryExportPaths, packageName);

    generated.push({
      packageName,
      outputPath: definition.outputPath,
      content: createPackageReadme({
        metadata,
        outputPath: definition.outputPath,
        publicEntrypoints
      })
    });
  }

  return generated;
}

/**
 * Записывает сгенерированные package README в рабочее дерево репозитория.
 */
export function writePackageReadmes(options = {}) {
  const repositoryRoot = options.repositoryRoot ?? DEFAULT_REPOSITORY_ROOT;
  const generated = generatePackageReadmes({ repositoryRoot });

  for (const entry of generated) {
    writeFileSync(
      resolveRepositoryPath(repositoryRoot, entry.outputPath),
      entry.content
    );
  }

  return generated;
}

/**
 * Строит итоговый markdown package README без ручного редактирования секций.
 */
function createPackageReadme({ metadata, outputPath, publicEntrypoints }) {
  const outputDirectory = path.dirname(outputPath);
  const docsLink = path.posix.relative(
    outputDirectory.replaceAll("\\", "/"),
    "docs/README.md"
  );
  const rootReadmeLink = path.posix.relative(
    outputDirectory.replaceAll("\\", "/"),
    "README.md"
  );

  return [
    `# ${metadata.title}`,
    "",
    "> Generated file. Do not edit manually.",
    "",
    "## Overview",
    "",
    metadata.summary,
    "",
    "## Public Entry Points",
    "",
    formatBulletList(
      publicEntrypoints.map(
        (entrypoint) =>
          `\`${entrypoint.importPath}\`: ${entrypoint.values
            .map((value) => `\`${value}\``)
            .join(", ")}`
      )
    ),
    "",
    "## Core Concepts",
    "",
    formatBulletList(
      metadata.sections.map(
        (section) => `${section.title}: ${section.summary}`
      )
    ),
    "",
    "## Best Practices",
    "",
    formatBulletList(metadata.bestPractices),
    "",
    "## Links",
    "",
    formatBulletList([
      `[Documentation Hub](${docsLink})`,
      `[Root README](${rootReadmeLink})`
    ]),
    ""
  ].join("\n");
}
