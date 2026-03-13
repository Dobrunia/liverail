/**
 * Возвращает короткое человекочитаемое описание runtime-значения для
 * диагностических сообщений о некорректной конфигурации.
 */
export function describeDiagnosticValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  const primitiveType = typeof value;

  if (primitiveType !== "object") {
    return primitiveType;
  }

  const constructorName = (value as { constructor?: { name?: unknown } })
    .constructor?.name;

  if (
    typeof constructorName === "string" &&
    constructorName.length > 0 &&
    constructorName !== "Object"
  ) {
    return constructorName;
  }

  return "object";
}
