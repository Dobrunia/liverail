import assert from "node:assert/strict";

import { test } from "vitest";

import {
  command,
  parseCommandAck,
  parseCommandInput,
  voidSchema
} from "../src/index.ts";

/**
 * Проверяет, что публичный contracts API дает официальный `voidSchema`
 * для самых частых no-payload сценариев без прямого импорта `zod` в
 * пользовательский код. Это важно, потому что минимальный happy path
 * должен оставаться коротким и не требовать рутинного `z.void()` в
 * каждом месте, где команда действительно не принимает данных.
 * Также покрывается corner case с input и ack одновременно, чтобы одна
 * и та же schema одинаково работала в обе стороны command-контракта.
 */
test("should expose a public void schema for no-payload command contracts", () => {
  const ping = command("ping", {
    input: voidSchema,
    ack: voidSchema
  });

  assert.equal(parseCommandInput(ping, undefined), undefined);
  assert.equal(parseCommandAck(ping, undefined), undefined);
});
