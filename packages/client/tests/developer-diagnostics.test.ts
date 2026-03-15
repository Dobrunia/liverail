import assert from "node:assert/strict";

import { test, vi } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  eventApplier
} from "../src/index.ts";

/**
 * Проверяет, что клиентский runtime не молчит при повторной подписке на уже
 * активный channel instance и отдает dev-only warning, сохраняя текущий no-op
 * runtime flow. Это важно, потому что дублирующиеся subscribe-вызовы часто
 * происходят из UI-логики и должны быть заметны разработчику, но не должны
 * ломать рабочий сценарий в production.
 * Также покрывается corner case с повторным `destroy`, чтобы явный no-op
 * lifecycle тоже сопровождался предупреждением вместо тихого игнора.
 */
test("should warn about duplicate subscriptions and repeated destroy calls in client runtime", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const globalChannel = channel("global", {
    key: z.object({
      roomId: z.string()
    })
  });
  const subscriptions: string[] = [];
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [globalChannel] as const
    }),
    transport: {
      async subscribeChannel(request) {
        subscriptions.push(`${request.name}:${JSON.stringify(request.key)}`);
      }
    }
  });

  try {
    const firstSubscription = await runtime.subscribeChannel("global", {
      roomId: "room-1"
    });
    const secondSubscription = await runtime.subscribeChannel("global", {
      roomId: "room-1"
    });

    runtime.destroy();
    runtime.destroy();

    assert.equal(firstSubscription, secondSubscription);
    assert.deepEqual(subscriptions, ['global:{"roomId":"room-1"}']);
    assert.equal(warnSpy.mock.calls.length, 2);
    assert.match(String(warnSpy.mock.calls[0]?.[0]), /already active/i);
    assert.match(String(warnSpy.mock.calls[1]?.[0]), /already destroyed/i);
  } finally {
    warnSpy.mockRestore();
  }
});

/**
 * Проверяет, что после `destroy` клиентский runtime отклоняет дальнейшие
 * stateful операции понятными ошибками, а неизвестные contract names дают
 * сообщение со списком зарегистрированных имен. Это важно, потому что такие
 * misuse-сценарии особенно часты в LLM-driven и UI-driven коде и должны
 * диагностироваться сразу в точке вызова, а не глубоким transport fail.
 * Также покрывается corner case с event applier, чтобы lifecycle-ограничение
 * одинаково применялось и к command flow, и к подписочному/реактивному API.
 */
test("should reject client runtime misuse with clear lifecycle and contract diagnostics", async () => {
  const ping = command("ping", {
    input: z.void(),
    ack: z.void()
  });
  const heartbeat = event("heartbeat", {
    payload: z.void()
  });
  const globalChannel = channel("global", {
    key: z.void()
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [ping] as const,
      events: [heartbeat] as const,
      channels: [globalChannel] as const
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

  runtime.destroy();

  await assert.rejects(
    () =>
      runtime.executeCommand("ping", undefined),
    {
      name: "TypeError",
      message:
        "Client runtime is destroyed and cannot execute commands."
    }
  );

  await assert.rejects(
    () =>
      runtime.subscribeChannel("global", undefined),
    {
      name: "TypeError",
      message:
        "Client runtime is destroyed and cannot manage channel subscriptions."
    }
  );

  assert.throws(
    () =>
      runtime.onEvent("heartbeat", () => undefined),
    {
      name: "TypeError",
      message:
        "Client runtime is destroyed and cannot register event listeners."
    }
  );

  assert.throws(
    () =>
      runtime.registerEventApplier(
        eventApplier(heartbeat, (state: { count: number }) => ({
          count: state.count + 1
        })),
        {
          getState() {
            return {
              count: 0
            };
          },
          setState() {
            return undefined;
          }
        }
      ),
    {
      name: "TypeError",
      message:
        "Client runtime is destroyed and cannot register event appliers."
    }
  );
});
