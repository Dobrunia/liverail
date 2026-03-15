import assert from "node:assert/strict";

import { test, vi } from "vitest";
import { z } from "zod";

import {
  channel,
  command,
  createContractRegistry,
  event,
  isRealtimeError
} from "dobrunia-liverail-contracts";
import {
  createClientRuntime,
  type ClientTransportConnectionReceiver,
  type ClientTransportEventReceiver
} from "../src/index.ts";

test("should apply default timeouts to hanging command transports", async () => {
  const slow = command("slow", {
    input: z.void(),
    ack: z.void()
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      commands: [slow] as const
    }),
    commandTimeoutMs: 20,
    transport: {
      sendCommand() {
        return new Promise(() => undefined);
      }
    }
  });

  await assert.rejects(
    () => runtime.executeCommand("slow", undefined),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "timeout");
      assert.deepEqual(error.details, {
        commandName: "slow",
        timeoutMs: 20
      });
      return true;
    }
  );
});

test("should apply timeouts and abort semantics to channel operations", async () => {
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  let unsubscribeCalls = 0;
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    channelOperationTimeoutMs: 20,
    transport: {
      async subscribeChannel() {
        return undefined;
      },
      unsubscribeChannel() {
        unsubscribeCalls += 1;
        return new Promise(() => undefined);
      }
    }
  });

  await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });

  await assert.rejects(
    () =>
      runtime.unsubscribeChannel("voice-room", {
        roomId: "room-1"
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "timeout");
      assert.deepEqual(error.details, {
        channelName: "voice-room",
        stage: "unsubscribe",
        timeoutMs: 20
      });
      return true;
    }
  );

  assert.equal(unsubscribeCalls, 1);
  assert.equal(runtime.inspectRuntime().activeSubscriptions.length, 1);

  const abortedCommand = command("aborted-command", {
    input: z.void(),
    ack: z.void()
  });
  let commandCalls = 0;
  const abortedCommandController = new AbortController();
  abortedCommandController.abort();
  const abortedCommandRuntime = createClientRuntime({
    registry: createContractRegistry({
      commands: [abortedCommand] as const
    }),
    transport: {
      sendCommand() {
        commandCalls += 1;
        return {
          status: "ack" as const,
          ack: undefined
        };
      }
    }
  });

  await assert.rejects(
    () =>
      abortedCommandRuntime.executeCommand("aborted-command", undefined, {
        signal: abortedCommandController.signal
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        commandName: "aborted-command",
        stage: "transport",
        reason: "aborted"
      });
      return true;
    }
  );
  assert.equal(commandCalls, 0);

  const abortedSubscribeController = new AbortController();
  abortedSubscribeController.abort();
  let subscribeCalls = 0;
  const abortedSubscribeRuntime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      subscribeChannel() {
        subscribeCalls += 1;
        return undefined;
      }
    }
  });

  await assert.rejects(
    () =>
      abortedSubscribeRuntime.subscribeChannel("voice-room", {
        roomId: "room-1"
      }, {
        signal: abortedSubscribeController.signal
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        channelName: "voice-room",
        stage: "subscribe",
        reason: "aborted"
      });
      return true;
    }
  );
  assert.equal(subscribeCalls, 0);

  const activeRuntime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    transport: {
      async subscribeChannel() {
        return undefined;
      },
      unsubscribeChannel() {
        unsubscribeCalls += 1;
        return undefined;
      }
    }
  });
  const abortedUnsubscribeController = new AbortController();

  await activeRuntime.subscribeChannel("voice-room", {
    roomId: "room-2"
  });
  abortedUnsubscribeController.abort();

  await assert.rejects(
    () =>
      activeRuntime.unsubscribeChannel("voice-room", {
        roomId: "room-2"
      }, {
        signal: abortedUnsubscribeController.signal
      }),
    (error: unknown) => {
      if (!isRealtimeError(error)) {
        return false;
      }

      assert.equal(error.code, "internal-error");
      assert.deepEqual(error.details, {
        channelName: "voice-room",
        stage: "unsubscribe",
        reason: "aborted"
      });
      return true;
    }
  );

  assert.equal(unsubscribeCalls, 1);
  assert.equal(activeRuntime.inspectRuntime().activeSubscriptions.length, 1);
});

test("should time out failed resubscriptions and clear stale local state", async () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const capturedErrors: unknown[] = [];
  const joinFailures: string[] = [];
  let subscribeCallCount = 0;
  const voiceRoom = channel("voice-room", {
    key: z.object({
      roomId: z.string()
    })
  });
  const runtime = createClientRuntime({
    registry: createContractRegistry({
      channels: [voiceRoom] as const
    }),
    onError(error) {
      capturedErrors.push(error);
    },
    channelOperationTimeoutMs: 20,
    transport: {
      bindConnection(nextReceiver) {
        connectionReceiver = nextReceiver;
      },
      subscribeChannel() {
        subscribeCallCount += 1;

        if (subscribeCallCount === 1) {
          return undefined;
        }

        return new Promise(() => undefined);
      },
      async unsubscribeChannel() {
        return undefined;
      }
    }
  });

  runtime.onSystemEvent("join_failed", (event) => {
    joinFailures.push(
      `${event.payload.channelName}:${String((event.payload.key as { roomId: string }).roomId)}:${event.payload.error.code}`
    );
  });

  await runtime.subscribeChannel("voice-room", {
    roomId: "room-1"
  });

  assert.ok(connectionReceiver !== undefined);

  connectionReceiver?.({
    status: "disconnected"
  });
  connectionReceiver?.({
    status: "connected"
  });
  await wait(40);

  assert.equal(capturedErrors.length, 1);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.deepEqual((capturedErrors[0] as { details: unknown }).details, {
    channelName: "voice-room",
    stage: "resubscribe",
    timeoutMs: 20
  });
  assert.deepEqual(joinFailures, [
    "voice-room:room-1:timeout"
  ]);
  assert.deepEqual(runtime.inspectRuntime().activeSubscriptions, []);
});

test("should serialize concurrent subscription operations for the same channel key", async () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const voiceRoom = channel("voice-room", {
      key: z.object({
        roomId: z.string()
      })
    });
    const calls: string[] = [];
    const subscribeGate = createDeferred<void>();
    const runtime = createClientRuntime({
      registry: createContractRegistry({
        channels: [voiceRoom] as const
      }),
      transport: {
        async subscribeChannel(request) {
          calls.push(`subscribe:start:${request.name}:${JSON.stringify(request.key)}`);
          await subscribeGate.promise;
          calls.push(`subscribe:done:${request.name}:${JSON.stringify(request.key)}`);
        },
        async unsubscribeChannel(request) {
          calls.push(`unsubscribe:${request.name}:${JSON.stringify(request.key)}`);
        }
      }
    });

    const firstSubscription = runtime.subscribeChannel("voice-room", {
      roomId: "room-1"
    });
    const secondSubscription = runtime.subscribeChannel("voice-room", {
      roomId: "room-1"
    });
    const unsubscribeResult = runtime.unsubscribeChannel("voice-room", {
      roomId: "room-1"
    });
    let unsubscribeSettled = false;

    void unsubscribeResult.then(() => {
      unsubscribeSettled = true;
    });

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(unsubscribeSettled, false);

    subscribeGate.resolve(undefined);

    const first = await firstSubscription;
    const second = await secondSubscription;

    assert.equal(first, second);
    assert.equal(await unsubscribeResult, true);
    assert.deepEqual(calls, [
      'subscribe:start:voice-room:{"roomId":"room-1"}',
      'subscribe:done:voice-room:{"roomId":"room-1"}',
      'unsubscribe:voice-room:{"roomId":"room-1"}'
    ]);
    assert.deepEqual(runtime.inspectRuntime().activeSubscriptions, []);
    assert.equal(warnSpy.mock.calls.length, 1);
  } finally {
    warnSpy.mockRestore();
  }
});

test("should isolate event listeners and swallow secondary onError failures", () => {
  let receiver: ClientTransportEventReceiver | undefined;
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const messageCreated = event("message-created", {
      payload: z.object({
        text: z.string()
      })
    });
    const receivedPayloads: string[] = [];
    const capturedErrors: string[] = [];
    const runtime = createClientRuntime({
      registry: createContractRegistry({
        events: [messageCreated] as const
      }),
      onError(error) {
        capturedErrors.push(error.code);
        throw new Error("onError crashed.");
      },
      transport: {
        bindEvents(nextReceiver) {
          receiver = nextReceiver;
        }
      }
    });

    runtime.onEvent("message-created", () => {
      throw new Error("Listener crashed.");
    });
    runtime.onEvent("message-created", (payload) => {
      receivedPayloads.push(payload.text);
    });

    assert.ok(receiver !== undefined);

    receiver({
      name: "message-created",
      payload: {
        text: "hello"
      },
      route: {
        target: "direct"
      }
    });

    receiver({
      name: "message-created",
      payload: {
        text: "again"
      },
      route: {
        target: "direct"
      }
    });

    assert.deepEqual(receivedPayloads, ["hello", "again"]);
    assert.deepEqual(capturedErrors, ["internal-error", "internal-error"]);
    assert.equal(consoleErrorSpy.mock.calls.length, 2);
  } finally {
    consoleErrorSpy.mockRestore();
  }
});

test("should isolate system and connection listeners from one another", () => {
  let connectionReceiver: ClientTransportConnectionReceiver | undefined;
  const capturedErrors: unknown[] = [];
  const seenSystemEvents: string[] = [];
  const seenStates: string[] = [];
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

  runtime.onSystemEvent("connected", () => {
    throw new Error("System event listener crashed.");
  });
  runtime.onSystemEvent("connected", (event) => {
    seenSystemEvents.push(event.payload.state);
  });
  runtime.onConnectionState(() => {
    throw new Error("Connection listener crashed.");
  });
  runtime.onConnectionState((snapshot) => {
    seenStates.push(snapshot.state);
  });

  assert.ok(connectionReceiver !== undefined);

  connectionReceiver({
    status: "connected"
  });

  assert.deepEqual(seenSystemEvents, ["connected"]);
  assert.deepEqual(seenStates, ["connected"]);
  assert.equal(capturedErrors.length, 2);
  assert.ok(isRealtimeError(capturedErrors[0]));
  assert.ok(isRealtimeError(capturedErrors[1]));
  assert.deepEqual((capturedErrors[0] as { details: unknown }).details, {
    systemEventName: "connected",
    stage: "listener"
  });
  assert.deepEqual((capturedErrors[1] as { details: unknown }).details, {
    state: "connected",
    stage: "listener"
  });
});

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

function wait(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
