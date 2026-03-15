import assert from "node:assert/strict";

import { test } from "vitest";
import { z } from "zod";

import {
  command,
  createContractRegistry,
  event
} from "@dobrunia-liverail/contracts";
import { createServerRuntime } from "../src/index.ts";

/**
 * Проверяет, что server runtime при обращении к неизвестным контрактам дает
 * сообщение с именем запрошенной сущности и списком реально зарегистрированных
 * имен. Это важно, потому что большая часть misuse в runtime сводится именно
 * к строковой ошибке в contract name и сообщение должно сразу подсказать
 * корректные варианты без ручного обхода registry в отладчике.
 * Также покрывается corner case с разными bucket-ами, чтобы одинаково
 * диагностировались и команды, и серверные события.
 */
test("should list registered contract names in server runtime misuse errors", async () => {
  const ping = command("ping", {
    input: z.void(),
    ack: z.void()
  });
  const heartbeat = event("heartbeat", {
    payload: z.void()
  });
  const runtime = createServerRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [heartbeat] as const
    })
  });

  await assert.rejects(
    () =>
      runtime.executeCommand("missing-command" as never, undefined),
    {
      name: "TypeError",
      message:
        'Unknown command contract: "missing-command". Registered commands: ping.'
    }
  );

  await assert.rejects(
    () =>
      runtime.emitEvent("missing-event" as never, undefined),
    {
      name: "TypeError",
      message:
        'Unknown event contract: "missing-event". Registered events: heartbeat.'
    }
  );
});
