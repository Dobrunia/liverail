import test from "node:test";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  event,
  isRealtimeValidationError
} from "@liverail/contracts";
import {
  applyEventApplier,
  eventApplier
} from "../src/index.ts";

/**
 * Проверяет, что event applier abstraction строится от event contract, а не от
 * строкового имени, и остается store-agnostic pure-моделью `state + event -> state`.
 * Это важно, потому что event-to-state слой не должен зависеть от конкретного store,
 * но обязан сохранять контрактную связь с typed payload события.
 * Также покрывается corner case с нормализацией payload через schema, чтобы
 * applier всегда работал уже с валидированными и приведенными значениями.
 */
test("should create store-agnostic event appliers from event contracts", () => {
  const messageCreated = event("message-created", {
    payload: z.object({
      text: z.string().trim().min(1)
    })
  });
  const appendMessage = eventApplier(
    messageCreated,
    (state: { messages: string[] }, payload) => ({
    messages: [...state.messages, payload.text]
    })
  );

  const nextState = applyEventApplier(
    appendMessage,
    {
      messages: ["first"]
    },
    {
      text: "  second  "
    }
  );

  assert.equal(appendMessage.event, messageCreated);
  assert.ok(Object.isFrozen(appendMessage));
  assert.deepEqual(nextState, {
    messages: ["first", "second"]
  });
});

/**
 * Проверяет, что event applier abstraction не пропускает невалидный payload
 * в пользовательский applier и нормализует ошибку в общий realtime формат.
 * Это важно, потому что event-to-state слой должен получать только корректные
 * события и не заставлять каждый экран вручную дублировать validation.
 * Также покрывается corner case с вложенным payload-path, чтобы downstream-слой
 * не терял точный путь и код ошибки при невалидном входящем событии.
 */
test("should normalize invalid payloads before applying event appliers", () => {
  const messageCreated = event("message-created", {
    payload: z.object({
      message: z.object({
        text: z.string().min(1)
      })
    })
  });
  const appendMessage = eventApplier(
    messageCreated,
    (state: { messages: string[] }, payload) => ({
      messages: [...state.messages, payload.message.text]
    })
  );

  assert.throws(
    () =>
      applyEventApplier(
        appendMessage,
        {
          messages: []
        },
        {
          message: {
            text: 42
          }
        } as never
      ),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-event-payload");
      assert.equal(error.details?.issues[0]?.path.join("."), "message.text");
      return true;
    }
  );
});
