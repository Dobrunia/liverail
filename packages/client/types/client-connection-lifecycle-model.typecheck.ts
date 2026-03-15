import { createContractRegistry } from "@dobrunia-liverail/contracts";
import { createClientRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что клиентский public API теперь публикует
 * явную lifecycle-модель соединения и listener для ее изменений. Это важно,
 * потому что UI и tooling должны работать с официальной connection-моделью,
 * а не с ad-hoc флагами поверх transport adapter-а.
 * Также покрывается corner case с debug snapshot, чтобы diagnostics-слой
 * ссылался на ту же typed lifecycle shape, что и inspectConnection API.
 */
const runtime = createClientRuntime({
  registry: createContractRegistry()
});
const snapshot = runtime.inspectConnection();
const stopListening = runtime.onConnectionState((nextSnapshot) => {
  nextSnapshot.state;
  nextSnapshot.connected;
});
const debugSnapshot = runtime.inspectRuntime();

snapshot.state satisfies
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";
debugSnapshot.connectionState.state satisfies
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";
stopListening satisfies () => void;
