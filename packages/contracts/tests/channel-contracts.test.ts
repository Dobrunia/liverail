import { test } from "vitest";
import assert from "node:assert/strict";

import { z } from "zod";

import {
  channel,
  createChannelInstance,
  createContractRegistry,
  isRealtimeValidationError,
  parseChannelKey
} from "../src/index.ts";

/**
 * Проверяет, что channel key объявляется через явную key schema и что
 * конкретный channel instance создается отдельно от шаблона канала.
 * Это важно, потому что contracts-слой должен различать template канала
 * и уже разрешенный instance для join/subscribe сценариев.
 * Также покрывается edge case с trim в key schema, чтобы instance получал
 * уже нормализованный ключ, а не сырое пользовательское значение.
 */
test("should create typed channel instances from explicit key schemas", () => {
  const voiceRoomChannel = channel("voice-room", {
    key: z.object({
      roomId: z.string().trim().min(1)
    })
  });

  const parsedKey = parseChannelKey(voiceRoomChannel, {
    roomId: "  room-1  "
  });
  const channelInstance = createChannelInstance(voiceRoomChannel, {
    roomId: "  room-1  "
  });

  assert.deepEqual(parsedKey, {
    roomId: "room-1"
  });
  assert.equal(channelInstance.contract, voiceRoomChannel);
  assert.equal(channelInstance.name, "voice-room");
  assert.deepEqual(channelInstance.key, {
    roomId: "room-1"
  });
  assert.ok(Object.isFrozen(channelInstance));
});

/**
 * Проверяет, что channel contracts больше не допускают отсутствие key schema,
 * даже если типовые ограничения были обойдены.
 * Это важно, потому что без строгого key-контракта комнаты быстро снова
 * превращаются в неструктурированные строки без общего формата.
 * Тест учитывает corner case с runtime-обходом типов, чтобы защита работала
 * не только на уровне TypeScript, но и при реальном вызове фабрики.
 */
test("should reject channel contracts without an explicit key schema", () => {
  assert.throws(
    () =>
      channel("invalid-channel", {} as never),
    {
      name: "TypeError",
      message: "Channel contracts must declare a key schema."
    }
  );
});

/**
 * Проверяет, что пустые каналы допустимы только через явную `z.void()`
 * schema и сохраняют строгий key-контракт после регистрации в registry.
 * Это важно, потому что даже канал без полезного ключа должен оставаться
 * формализованным и детерминированным с точки зрения контракта.
 * Также покрывается edge case с registry lookup, чтобы следующий runtime-слой
 * мог строить channel instance уже из зарегистрированного контракта.
 */
test("should allow empty channels only through explicit void schemas", () => {
  const globalChannel = channel("global", {
    key: z.void()
  });
  const registry = createContractRegistry({
    channels: [globalChannel] as const
  });

  assert.equal(parseChannelKey(globalChannel, undefined), undefined);
  assert.equal(
    createChannelInstance(registry.channels.byName.global, undefined).key,
    undefined
  );
});

/**
 * Проверяет, что невалидный channel key нормализуется в unified realtime error
 * с кодом `invalid-channel-key` и корректным issue-path.
 * Это важно, потому что ключ канала участвует в адресации подписок и должен
 * валидироваться так же строго, как input команд и payload событий.
 * Тест учитывает corner case с вложенным key-полем, чтобы issue-path оставался
 * пригодным для следующего слоя нормализации ошибок.
 */
test("should normalize invalid channel keys into realtime errors", () => {
  const voiceRoomChannel = channel("voice-room", {
    key: z.object({
      room: z.object({
        id: z.string().uuid()
      })
    })
  });

  assert.throws(
    () =>
      parseChannelKey(voiceRoomChannel, {
        room: {
          id: "room-1"
        }
      }),
    (error: unknown) => {
      if (!isRealtimeValidationError(error)) {
        return false;
      }

      assert.equal(error.code, "invalid-channel-key");
      assert.equal(error.details?.source, "zod");
      assert.equal(error.details?.issues[0]?.path.join("."), "room.id");
      return true;
    }
  );
});
