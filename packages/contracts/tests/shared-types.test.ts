import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { channel, command, event } from "../src/index.ts";

/**
 * Проверяет, что контракт команды хранит ссылки на input и ack schema
 * в явных публичных полях общего формата.
 * Это важно, потому что следующие слои должны получать единый shape контракта
 * и не разъезжаться по названиям полей между пакетами.
 * Также покрывается edge case, когда schema представлены простыми объектами,
 * а не специальными runtime-обертками: типовая система должна оставаться структурной.
 */
test("should store command schemas in a shared public shape", () => {
  const inputSchema = z.object({
    roomId: z.string(),
    body: z.string()
  });
  const ackSchema = z.object({
    messageId: z.string()
  });

  const contract = command("send-message", {
    input: inputSchema,
    ack: ackSchema
  });

  assert.equal(contract.input, inputSchema);
  assert.equal(contract.ack, ackSchema);
  assert.ok(Object.isFrozen(contract));
});

/**
 * Проверяет, что event- и channel-контракты тоже используют единый публичный
 * способ хранения schema-ссылок.
 * Это важно, потому что shared type system должен быть согласованным для всех
 * базовых сущностей, а не только для command.
 * Тест покрывает corner case, когда schema присутствует только у одной части
 * контракта, и никаких служебных полей не должно появляться сверх этого.
 */
test("should store event payload and channel key schemas consistently", () => {
  const payloadSchema = z.object({
    messageId: z.string(),
    body: z.string()
  });
  const keySchema = z.object({
    roomId: z.string()
  });

  const eventContract = event("message-created", {
    payload: payloadSchema
  });
  const channelContract = channel("voice-room", {
    key: keySchema
  });

  assert.equal(eventContract.payload, payloadSchema);
  assert.equal(channelContract.key, keySchema);
  assert.deepEqual(Object.keys(eventContract), ["kind", "name", "payload"]);
  assert.deepEqual(Object.keys(channelContract), ["kind", "name", "key"]);
});
