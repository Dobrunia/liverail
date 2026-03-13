import assert from "node:assert/strict";

import { test } from "vitest";

import {
  command,
  voidSchema
} from "../src/index.ts";

/**
 * Проверяет, что contracts layer сообщает не только сам факт misconfiguration,
 * но и какой именно неподходящий value был передан вместо schema. Это важно,
 * потому что такие ошибки обычно появляются на раннем этапе и должны сразу
 * вести разработчика к конкретной причине, а не заставлять гадать по стектрейсу.
 * Также покрывается corner case с примитивным значением, чтобы сообщение не
 * деградировало до бесполезного `[object Object]` или общего "invalid schema".
 */
test("should explain which invalid value was passed instead of a contract schema", () => {
  assert.throws(
    () =>
      command("ping", {
        input: 123 as never,
        ack: voidSchema
      }),
    {
      name: "TypeError",
      message:
        'Contract command input schema must be a Zod schema. Received: number.'
    }
  );
});
