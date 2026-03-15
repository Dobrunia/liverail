import { readFileSync } from "node:fs";
import path from "node:path";

const PACKAGE_SOURCE_ALIASES = Object.freeze({
  "dobrunia-liverail-client": "packages/client/src/index.ts",
  "dobrunia-liverail-contracts": "packages/contracts/src/index.ts",
  "dobrunia-liverail-server": "packages/server/src/index.ts"
});

/**
 * Читает JSON-файл и возвращает разобранный объект.
 */
export function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Разрешает путь относительно корня репозитория.
 */
export function resolveRepositoryPath(repositoryRoot, relativePath) {
  return path.resolve(repositoryRoot, relativePath);
}

/**
 * Преобразует export path из package.json в реальный import path пакета.
 */
export function toPackageImportPath(packageName, exportPath) {
  return exportPath === "." ? packageName : `${packageName}/${exportPath.slice(2)}`;
}

/**
 * Извлекает value/type exports из barrel entrypoint-а без обращения к dist.
 * Генераторы документации используют это как официальный слой public API.
 */
export function readEntrypointExports(sourcePath) {
  const values = [];
  const types = [];

  for (const entry of readReExportEntries(sourcePath)) {
    const target = entry.kind === "type" ? types : values;

    for (const name of entry.names) {
      target.push(name);
    }
  }

  return Object.freeze({
    values: Object.freeze(values),
    types: Object.freeze(types)
  });
}

/**
 * Проверяет, что generator model ссылается только на реально опубликованные
 * package exports, а не на случайные внутренние entrypoints.
 */
export function assertPackageExports(packageJson, entryExportPaths, packageName) {
  for (const exportPath of entryExportPaths) {
    if (!(exportPath in packageJson.exports)) {
      throw new TypeError(
        `Package README generation model references a missing export path "${exportPath}" in ${packageName}.`
      );
    }
  }
}

/**
 * Строит markdown-список из готовых строк без лишней логики шаблонизации.
 */
export function formatBulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Возвращает список re-export блоков из public entrypoint файла.
 */
export function readReExportEntries(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const entries = [];

  for (const match of source.matchAll(
    /export(?: (type))?\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g
  )) {
    entries.push({
      kind: match[1] === "type" ? "type" : "value",
      names: (match[2] ?? "")
        .split(",")
        .map((item) => item.trim().replace(/\s+as\s+.+$/, ""))
        .filter((item) => item.length > 0),
      sourceSpecifier: match[3]
    });
  }

  return Object.freeze(entries);
}

/**
 * Собирает описания публичных exports для одного entrypoint-а через JSDoc.
 */
export function describeEntrypointExports(sourcePath, repositoryRoot) {
  const described = [];

  for (const entry of readReExportEntries(sourcePath)) {
    const resolvedSourcePath = resolveModulePath(
      sourcePath,
      entry.sourceSpecifier,
      repositoryRoot
    );

    for (const name of entry.names) {
      described.push(
        Object.freeze({
          kind: entry.kind,
          name,
          description: describeExport({
            exportName: name,
            exportKind: entry.kind,
            repositoryRoot,
            sourcePath: resolvedSourcePath,
            visited: new Set()
          })
        })
      );
    }
  }

  return Object.freeze(described);
}

function resolveModulePath(sourcePath, sourceSpecifier, repositoryRoot) {
  if (sourceSpecifier.startsWith(".")) {
    return path.resolve(path.dirname(sourcePath), sourceSpecifier);
  }

  if (sourceSpecifier in PACKAGE_SOURCE_ALIASES) {
    return resolveRepositoryPath(
      repositoryRoot,
      PACKAGE_SOURCE_ALIASES[sourceSpecifier]
    );
  }

  throw new TypeError(
    `Documentation generator cannot resolve module specifier "${sourceSpecifier}".`
  );
}

function describeExport({
  exportName,
  exportKind,
  repositoryRoot,
  sourcePath,
  visited
}) {
  const visitKey = `${sourcePath}:${exportName}:${exportKind}`;

  if (visited.has(visitKey)) {
    return createFallbackDescription(exportName, exportKind);
  }

  visited.add(visitKey);

  const source = readFileSync(sourcePath, "utf8");
  const documentedDeclaration = findDocumentedDeclaration(source, exportName);

  if (documentedDeclaration !== null) {
    return documentedDeclaration;
  }

  for (const entry of readReExportEntries(sourcePath)) {
    if (!entry.names.includes(exportName)) {
      continue;
    }

    return describeExport({
      exportName,
      exportKind: entry.kind,
      repositoryRoot,
      sourcePath: resolveModulePath(sourcePath, entry.sourceSpecifier, repositoryRoot),
      visited
    });
  }

  return createFallbackDescription(exportName, exportKind);
}

function findDocumentedDeclaration(source, exportName) {
  const escapedName = escapeForRegExp(exportName);
  const declarationMatch = source.match(
    new RegExp(
      String.raw`export(?:\s+declare)?\s+(?:interface|type|function|const|class)\s+${escapedName}\b`
    )
  );

  if (declarationMatch === null || declarationMatch.index === undefined) {
    return null;
  }

  const declarationIndex = declarationMatch.index;
  const prefix = source.slice(0, declarationIndex);
  const commentStart = prefix.lastIndexOf("/**");
  const commentEnd = prefix.lastIndexOf("*/");

  if (commentStart === -1 || commentEnd === -1 || commentEnd < commentStart) {
    return null;
  }

  if (prefix.slice(commentEnd + 2).trim().length > 0) {
    return null;
  }

  return extractSummary(prefix.slice(commentStart + 3, commentEnd));
}

function extractSummary(commentBody) {
  const lines = [];

  for (const rawLine of commentBody.split("\n")) {
    const normalized = rawLine.replace(/^\s*\*\s?/, "").trim();

    if (normalized.startsWith("@")) {
      break;
    }

    if (normalized.length === 0) {
      if (lines.length > 0) {
        break;
      }

      continue;
    }

    lines.push(normalized);
  }

  return lines.length > 0 ? lines.join(" ") : "Public API export.";
}

function createFallbackDescription(exportName, exportKind) {
  return exportKind === "type"
    ? `Public type export \`${exportName}\`.`
    : `Public value export \`${exportName}\`.`;
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
