import {
  andPolicy,
  commandPolicy,
  connectPolicy,
  notPolicy,
  orPolicy,
  type CommandPolicyContract,
  type ConnectPolicyContract
} from "../src/index.js";

/**
 * Проверяет на уровне типов, что policy composition сохраняет контекст и scope
 * исходных policy contracts и не размывает их до неструктурированного типа.
 * Это важно, потому что дальше server runtime должен навешивать composed policy
 * на конкретную фазу без ручных generic-аннотаций и cast-ов.
 * Также покрывается corner case с инверсией через `not`, чтобы даже unary
 * composition не теряла точный scope исходного правила.
 */
const isAuthenticated = connectPolicy("is-authenticated", {
  evaluate: ({ context }: { context: { authenticated: boolean } }) =>
    context.authenticated
});
const isNotBanned = connectPolicy("is-not-banned", {
  evaluate: ({ context }: { context: { banned: boolean } }) => !context.banned
});
const canModerate = commandPolicy("can-moderate", {
  evaluate: ({ context }: { context: { role: "admin" | "user" } }) =>
    context.role === "admin"
});

const canConnect = andPolicy("can-connect", [isAuthenticated, isNotBanned]);
const canConnectWithBypass = orPolicy("can-connect-with-bypass", [
  isAuthenticated,
  isNotBanned
]);
const isAnonymous = notPolicy("is-anonymous", isAuthenticated);

type ShouldPreserveScopedPolicyContracts = Assert<
  IsEqual<
    typeof canConnect,
    ConnectPolicyContract<"can-connect", { authenticated: boolean } & { banned: boolean }>
  > &
    IsEqual<
      typeof canConnectWithBypass,
      ConnectPolicyContract<
        "can-connect-with-bypass",
        { authenticated: boolean } & { banned: boolean }
      >
    > &
    IsEqual<
      typeof isAnonymous,
      ConnectPolicyContract<"is-anonymous", { authenticated: boolean }>
    > &
    IsEqual<
      typeof canModerate,
      CommandPolicyContract<
        "can-moderate",
        any,
        { role: "admin" | "user" }
      >
    >
>;

// @ts-expect-error composition must reject policies with different scopes
andPolicy("invalid-composition", [isAuthenticated, canModerate]);

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
