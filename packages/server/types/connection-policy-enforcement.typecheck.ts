import {
  connectPolicy,
  createContractRegistry,
  type ConnectPolicyContract
} from "@liverail/contracts";
import { createServerRuntime } from "../src/index.js";

/**
 * Проверяет на уровне типов, что connection policy enforcement в runtime
 * принимает scoped connect policy и пробрасывает typed context в evaluate.
 * Это важно, потому что connect stage должен быть централизованным, но при этом
 * не терять конкретный shape контекста подключения.
 * Также покрывается corner case с `authorizeConnection`, чтобы метод runtime
 * требовал тот же context shape, что и подключенные connect policy.
 */
const isAuthenticated = connectPolicy("is-authenticated", {
  evaluate: ({ context }: { context: { authenticated: boolean } }) =>
    context.authenticated
});
const runtime = createServerRuntime<{ authenticated: boolean }>({
  registry: createContractRegistry(),
  connectionPolicies: [isAuthenticated]
});

type ShouldAcceptScopedConnectPolicies = Assert<
  IsEqual<
    typeof isAuthenticated,
    ConnectPolicyContract<"is-authenticated", { authenticated: boolean }>
  >
>;

type ShouldRequireTypedConnectionContext = Assert<
  IsEqual<
    Parameters<typeof runtime.authorizeConnection>[0],
    {
      readonly context: {
        authenticated: boolean;
      };
    }
  >
>;

runtime.authorizeConnection({
  // @ts-expect-error connection authorization must enforce the runtime context shape
  context: {}
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
