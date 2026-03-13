import type { CommandAckResult, CommandResult } from "../src/index.js";

/**
 * Проверяет на уровне типов, что shared ack model для команд выражен как
 * явный discriminated union с состояниями `ack` и `missing-ack`.
 * Это важно, потому что transport/client layer должны различать отсутствие ack
 * и валидный ack без ручных строковых соглашений и callback-паттернов.
 * Также покрывается corner case с `void`-ack, чтобы явное подтверждение без
 * payload оставалось отличимым от сценария полного отсутствия подтверждения.
 */
type ShouldModelExplicitCommandAcknowledgements = Assert<
  IsEqual<
    CommandAckResult<void>,
    | {
        readonly status: "ack";
        readonly ack: void;
      }
    | {
        readonly status: "missing-ack";
      }
  >
>;

/**
 * Проверяет на уровне типов, что расширенная command result model покрывает
 * не только ack, но и explicit failure/timeout сценарии reliability-слоя.
 * Это важно, потому что transport/client layer должны иметь единый contract
 * для успешного ack, missing ack, timeout и явного transport failure.
 * Также покрывается corner case с `error: unknown`, чтобы transport adapter
 * мог вернуть исходную причину без искусственного сужения типа.
 */
type ShouldModelCommandReliabilityResults = Assert<
  IsEqual<
    CommandResult<void>,
    | {
        readonly status: "ack";
        readonly ack: void;
      }
    | {
        readonly status: "missing-ack";
      }
    | {
        readonly status: "error";
        readonly error: unknown;
      }
    | {
        readonly status: "timeout";
      }
  >
>;

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
