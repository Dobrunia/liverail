import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  createContractRegistry,
  event,
  isRealtimeValidationError,
  parseEventPayload
} from "../src/index.ts";

/**
 * Проверяет, что событие объявляется через явную payload schema и валидируется
 * через нее без дополнительных ручных преобразований.
 * Это важно, потому что server-to-client события должны иметь строгий shape
 * и единый смысл, а не передаваться как произвольные объекты.
 * Также покрывается edge case с `coerce.date()`, чтобы payload schema могла
 * нормализовать входные данные, а не только проверять их.
 */
test("should validate event payloads through an explicit payload schema", () => {
  const memberJoinedEvent = event("member-joined", {
    payload: z.object({
      roomId: z.string(),
      joinedAt: z.coerce.date()
    })
  });

  const parsedPayload = parseEventPayload(memberJoinedEvent, {
    roomId: "room-1",
    joinedAt: "2026-03-13T12:00:00.000Z"
  });

  assert.deepEqual(parsedPayload, {
    roomId: "room-1",
    joinedAt: new Date("2026-03-13T12:00:00.000Z")
  });
});

/**
 * Проверяет, что event contracts больше не допускают отсутствие payload schema,
 * даже если типовые ограничения были обойдены через `as never`.
 * Это важно, потому что без обязательной payload schema событие снова
 * превращается в нестрогий transport-level пакет без контракта.
 * Тест учитывает corner case с runtime-обходом типов, чтобы защита работала
 * не только на уровне TypeScript, но и при реальном вызове фабрики.
 */
test("should reject event contracts without an explicit payload schema", () => {
  assert.throws(
    () =>
      event("invalid-event", {} as never),
    {
      name: "TypeError",
      message: "Event contracts must declare a payload schema."
    }
  );
});

/**
 * Проверяет, что пустые события остаются допустимыми только через явную `z.void()`
 * schema и не теряют эту информацию после регистрации в registry.
 * Это важно, потому что даже события без полезной нагрузки должны быть
 * описаны контрактно, а не через молчаливое отсутствие поля.
 * Также покрывается edge case с registry lookup, чтобы следующему runtime-слою
 * была доступна та же строгая payload-модель по имени события.
 */
test("should allow empty events only through explicit void schemas", () => {
  const heartbeatEvent = event("heartbeat", {
    payload: z.void()
  });
  const registry = createContractRegistry({
    events: [heartbeatEvent] as const
  });

  assert.equal(parseEventPayload(heartbeatEvent, undefined), undefined);
  assert.equal(registry.events.byName.heartbeat.payload, heartbeatEvent.payload);
});

/**
 * Проверяет, что невалидный payload события нормализуется в unified realtime error
 * с кодом `invalid-event-payload` и корректным issue-path.
 * Это важно, потому что события должны проходить через тот же строгий validation
 * flow, что и команды, но наружу выдавать уже стабильный error shape.
 * Тест учитывает corner case с вложенным полем, чтобы не потерять глубину path.
 */
test("should normalize invalid event payloads into realtime errors", () => {
  const messageCreatedEvent = event("message-created", {
    payload: z.object({
      message: z.object({
        id: z.string().uuid()
      })
    })
  });

  assert.throws(
    () =>
      parseEventPayload(messageCreatedEvent, {
        message: {
          id: "message-1"
        }
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-event-payload");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "message.id");
      return true;
    }
  );
});
