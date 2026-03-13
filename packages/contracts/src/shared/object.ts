/**
 * Определяет, можно ли трактовать значение как обычный объект или массив
 * для целей копирования и заморозки.
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/**
 * Создает глубокую копию простых декларативных структур, чтобы дальнейшие
 * изменения исходных объектов не влияли на контракт.
 */
export function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneDeep(entry)) as T;
  }

  if (isObjectLike(value)) {
    const clone: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneDeep(entry);
    }

    return clone as T;
  }

  return value;
}

/**
 * Глубоко замораживает декларативные структуры, чтобы исключить runtime-мутации
 * уже объявленных контрактов.
 */
export function deepFreeze<T>(value: T): T {
  if (!isObjectLike(value) && typeof value !== "function") {
    return value;
  }

  if (isSchemaLike(value)) {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }

  return Object.freeze(value);
}

function isSchemaLike(value: unknown): value is {
  parse: (input: unknown) => unknown;
  safeParse: (input: unknown) => unknown;
} {
  return (
    isObjectLike(value) &&
    typeof value.parse === "function" &&
    typeof value.safeParse === "function"
  );
}
