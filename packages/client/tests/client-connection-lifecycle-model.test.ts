import assert from "node:assert/strict";

import { test } from "vitest";

import { createContractRegistry, isRealtimeError } from "@liverail/contracts";
import {
  createClientRuntime,
  type ClientTransportConnectionReceiver
} from "../src/index.ts";

/**
 * Проверяет, что client runtime ведет одну централизованную lifecycle-модель
 * соединения и отдает ее наружу через inspect/listener API, а не набором
 * разрозненных флагов в пользовательском коде. Это важно, потому что UI и
 * operational-логика должны опираться на единый источник истины о состоянии
 * realtime-сессии.
 * Также покрывается corner case с reconnect-переходами и terminal failure,
 * чтобы модель различала `connecting`, `connected`, `disconnected`,
 * `reconnecting` и `failed`, не смешивая их между собой.
 */
test("should keep a centralized client connection lifecycle model and notify listeners about transitions", () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const seenStates: string[] = [];
  const runtime = createClientRuntime({
    registry: createContractRegistry(),
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      }
    }
  });
  const stopListening = runtime.onConnectionState((snapshot) => {
    seenStates.push(snapshot.state);
  });

  assert.equal(runtime.inspectConnection().state, "connecting");

  connectionReceiver?.({
    status: "connected"
  });
  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "reconnecting"
  });
  connectionReceiver?.({
    status: "connected"
  });
  connectionReceiver?.({
    status: "failed",
    error: new Error("Dial failed.")
  });

  const lifecycle = runtime.inspectConnection();

  stopListening();

  assert.deepEqual(seenStates, [
    "connected",
    "disconnected",
    "reconnecting",
    "connected",
    "failed"
  ]);
  assert.equal(lifecycle.state, "failed");
  assert.equal(lifecycle.previousState, "connected");
  assert.equal(lifecycle.connected, false);
  assert.equal(lifecycle.transportBound, true);
});

/**
 * Проверяет, что runtime без connection-aware transport остается в состоянии
 * `idle`, а transport failures при lifecycle-событии `failed` нормализуются
 * через существующий client error hook вместо сырых исключений. Это важно,
 * потому что lifecycle-модель должна быть полезной и в минимальном режиме
 * без транспорта, и в режиме явных transport failures.
 * Также покрывается corner case с debug snapshot, чтобы diagnostics-слой
 * показывал тот же lifecycle state, что и основное inspect API клиента.
 */
test("should keep idle lifecycle without transport and report failed connection transitions through the client error hook", () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const capturedErrors: unknown[] = [];
  const runtime = createClientRuntime({
    registry: createContractRegistry(),
    onError(error) {
      capturedErrors.push(error);
    },
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      }
    }
  });
  const idleRuntime = createClientRuntime({
    registry: createContractRegistry()
  });

  assert.equal(idleRuntime.inspectConnection().state, "idle");

  connectionReceiver?.({
    status: "failed",
    error: new Error("Handshake failed.")
  });

  const connectionSnapshot = runtime.inspectConnection();
  const debugSnapshot = runtime.inspectRuntime();

  assert.equal(connectionSnapshot.state, "failed");
  assert.equal(debugSnapshot.connectionState.state, "failed");
  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.deepEqual((capturedErrors[0] as { details: unknown }).details, {
    stage: "connect"
  });
});
