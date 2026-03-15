import assert from "node:assert/strict";

import { z } from "zod";
import { test } from "vitest";

import {
  command,
  createContractRegistry,
  defineCommands
} from "dobrunia-liverail-contracts";
import { defineServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что strongly typed server runtime helper остается тонкой оберткой
 * над существующим runtime и не меняет поведение command pipeline на runtime-уровне.
 * Это важно, потому что новый public helper должен улучшать authoring-time typing,
 * но не создавать отдельную параллельную модель выполнения на сервере.
 * Также покрывается corner case с registry helper-ами, чтобы вместе они давали
 * короткий и типобезопасный путь без лишнего `as const` и ручных generic-ов.
 */
test("should create server runtimes through the strongly typed public helper", async () => {
  const setVolume = command("set-volume", {
    input: z.object({
      roomId: z.string(),
      level: z.number().int().min(0).max(100)
    }),
    ack: z.object({
      appliedLevel: z.number().int().min(0).max(100)
    })
  });
  const runtime = defineServerRuntime({
    registry: createContractRegistry({
      commands: defineCommands(setVolume)
    }),
    commandHandlers: {
      "set-volume": () => ({
        appliedLevel: 42
      })
    }
  });

  const ack = await runtime.executeCommand("set-volume", {
    roomId: "room-1",
    level: 42
  }, {
    context: undefined
  });

  assert.deepEqual(ack, {
    appliedLevel: 42
  });
});
