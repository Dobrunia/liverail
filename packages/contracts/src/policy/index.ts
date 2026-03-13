import type { RealtimeErrorCode, RealtimeErrorDetails } from "../errors/index.ts";
import type { ChannelContract, ChannelKey } from "../channel/index.ts";
import type { CommandContract, CommandInput } from "../command/index.ts";
import type { EventContract, EventPayload } from "../event/index.ts";
import type { RuntimeContext } from "../shared/runtime.ts";
import { deepFreeze } from "../shared/object.ts";
import {
  createPrimitive,
  type ContractPrimitive,
  type ContractPrimitiveOptions
} from "../shared/primitives.ts";

/**
 * Поддерживаемые scope-значения для policy layer.
 */
export const POLICY_SCOPES = Object.freeze([
  "connect",
  "join",
  "command",
  "receive"
] as const);

/**
 * Официальный scope policy layer.
 */
export type PolicyScope = (typeof POLICY_SCOPES)[number];

/**
 * Явное разрешение policy-проверки.
 */
export interface PolicyAllowDecision {
  /**
   * Явный маркер успешного разрешения.
   */
  readonly allowed: true;
}

/**
 * Явный отказ policy-проверки с официальным error code.
 */
export interface PolicyDenyDecision<
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> {
  /**
   * Явный маркер отказа.
   */
  readonly allowed: false;

  /**
   * Необязательный официальный код отказа.
   */
  readonly code?: TCode;

  /**
   * Необязательное человекочитаемое описание отказа.
   */
  readonly message?: string;

  /**
   * Необязательные сериализуемые детали отказа.
   */
  readonly details?: RealtimeErrorDetails;
}

/**
 * Явная policy-decision форма поверх boolean-результата.
 */
export type PolicyDecision<TCode extends RealtimeErrorCode = RealtimeErrorCode> =
  | PolicyAllowDecision
  | PolicyDenyDecision<TCode>;

/**
 * Нормализованный результат policy-проверки до async-обертки.
 */
export type PolicyResolution<
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> = boolean | PolicyDecision<TCode>;

/**
 * Результат исполнения policy-проверки.
 */
export type PolicyResult<TCode extends RealtimeErrorCode = RealtimeErrorCode> =
  PolicyResolution<TCode> | Promise<PolicyResolution<TCode>>;

/**
 * Функция проверки доступа или иного runtime-условия.
 */
export type PolicyEvaluator<
  TContext = unknown,
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> = (context: TContext) => PolicyResult<TCode>;

/**
 * Опции декларативной policy-сущности.
 */
export interface PolicyOptions<
  TContext = unknown,
  TScope extends PolicyScope | undefined = undefined,
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> extends ContractPrimitiveOptions {
  /**
   * Проверка, которую должен выполнить runtime.
   */
  readonly evaluate: PolicyEvaluator<TContext, TCode>;

  /**
   * Необязательный scope policy, если контракт уже привязан к конкретной фазе.
   */
  readonly scope?: TScope;
}

/**
 * Декларативный контракт policy с прикрепленной функцией проверки.
 */
export interface PolicyContract<
  TName extends string = string,
  TContext = RuntimeContext,
  TScope extends PolicyScope | undefined = undefined,
  TCode extends RealtimeErrorCode = RealtimeErrorCode
> extends ContractPrimitive<"policy", TName> {
  /**
   * Необязательный policy scope.
   */
  readonly scope?: TScope;

  /**
   * Проверка, которую вызывает runtime при оценке policy.
   */
  readonly evaluate: PolicyEvaluator<TContext, TCode>;
}

/**
 * Типизированный контекст исполнения policy.
 */
export interface PolicyContext<
  TPolicy extends PolicyContract<string, any, any, any> = PolicyContract<
    string,
    any,
    any,
    any
  >,
  TRuntimeContext = RuntimeContext
> {
  /**
   * Policy-контракт, который оценивается runtime-слоем.
   */
  readonly contract: TPolicy;

  /**
   * Имя policy как стабильный идентификатор правила.
   */
  readonly name: TPolicy["name"];

  /**
   * Runtime-контекст, передаваемый в policy evaluator.
   */
  readonly context: TRuntimeContext;
}

/**
 * Контекст connection policy.
 */
export interface ConnectPolicyContext<TRuntimeContext = unknown> {
  /**
   * Runtime-контекст подключения.
   */
  readonly context: TRuntimeContext;
}

/**
 * Контекст join policy.
 */
export interface JoinPolicyContext<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт канала.
   */
  readonly contract: TChannel;

  /**
   * Имя канала как стабильный identifier.
   */
  readonly name: TChannel["name"];

  /**
   * Нормализованный ключ конкретного channel instance.
   */
  readonly key: ChannelKey<TChannel>;

  /**
   * Идентификатор участника, входящего в канал.
   */
  readonly memberId: string;

  /**
   * Runtime-контекст join-операции.
   */
  readonly context: TRuntimeContext;
}

/**
 * Контекст command policy.
 */
export interface CommandPolicyContext<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown
> {
  /**
   * Контракт исполняемой команды.
   */
  readonly contract: TCommand;

  /**
   * Имя команды как стабильный identifier.
   */
  readonly name: TCommand["name"];

  /**
   * Нормализованный command input.
   */
  readonly input: CommandInput<TCommand>;

  /**
   * Runtime-контекст command pipeline.
   */
  readonly context: TRuntimeContext;
}

/**
 * Контекст receive policy.
 */
export interface ReceivePolicyContext<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown,
  TRoute = unknown
> {
  /**
   * Контракт доставляемого события.
   */
  readonly contract: TEvent;

  /**
   * Имя события как стабильный identifier.
   */
  readonly name: TEvent["name"];

  /**
   * Нормализованный payload события.
   */
  readonly payload: EventPayload<TEvent>;

  /**
   * Route-контекст конкретной доставки.
   */
  readonly route: TRoute;

  /**
   * Runtime-контекст receive-проверки.
   */
  readonly context: TRuntimeContext;
}

/**
 * Допустимые deny-коды для connection policy.
 */
export type ConnectPolicyErrorCode =
  | "connection-denied"
  | "unauthorized"
  | "forbidden";

/**
 * Допустимые deny-коды для join policy.
 */
export type JoinPolicyErrorCode = "join-denied" | "unauthorized" | "forbidden";

/**
 * Допустимые deny-коды для command policy.
 */
export type CommandPolicyErrorCode = "unauthorized" | "forbidden";

/**
 * Допустимые deny-коды для receive policy.
 */
export type ReceivePolicyErrorCode = "unauthorized" | "forbidden";

/**
 * Специализированный policy-контракт для connection access layer.
 */
export type ConnectPolicyContract<
  TName extends string = string,
  TRuntimeContext = unknown,
  TCode extends ConnectPolicyErrorCode = ConnectPolicyErrorCode
> = PolicyContract<
  TName,
  ConnectPolicyContext<TRuntimeContext>,
  "connect",
  TCode
>;

/**
 * Специализированный policy-контракт для channel join layer.
 */
export type JoinPolicyContract<
  TName extends string = string,
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown,
  TCode extends JoinPolicyErrorCode = JoinPolicyErrorCode
> = PolicyContract<
  TName,
  JoinPolicyContext<TChannel, TRuntimeContext>,
  "join",
  TCode
>;

/**
 * Специализированный policy-контракт для command access layer.
 */
export type CommandPolicyContract<
  TName extends string = string,
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown,
  TCode extends CommandPolicyErrorCode = CommandPolicyErrorCode
> = PolicyContract<
  TName,
  CommandPolicyContext<TCommand, TRuntimeContext>,
  "command",
  TCode
>;

/**
 * Специализированный policy-контракт для receive layer.
 */
export type ReceivePolicyContract<
  TName extends string = string,
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown,
  TRoute = unknown,
  TCode extends ReceivePolicyErrorCode = ReceivePolicyErrorCode
> = PolicyContract<
  TName,
  ReceivePolicyContext<TEvent, TRuntimeContext, TRoute>,
  "receive",
  TCode
>;

/**
 * Опции connection policy.
 */
export interface ConnectPolicyOptions<
  TRuntimeContext = unknown,
  TCode extends ConnectPolicyErrorCode = ConnectPolicyErrorCode
> extends PolicyOptions<ConnectPolicyContext<TRuntimeContext>, "connect", TCode> {}

/**
 * Опции join policy.
 */
export interface JoinPolicyOptions<
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown,
  TCode extends JoinPolicyErrorCode = JoinPolicyErrorCode
> extends PolicyOptions<JoinPolicyContext<TChannel, TRuntimeContext>, "join", TCode> {}

/**
 * Опции command policy.
 */
export interface CommandPolicyOptions<
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown,
  TCode extends CommandPolicyErrorCode = CommandPolicyErrorCode
> extends PolicyOptions<
    CommandPolicyContext<TCommand, TRuntimeContext>,
    "command",
    TCode
  > {}

/**
 * Опции receive policy.
 */
export interface ReceivePolicyOptions<
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown,
  TRoute = unknown,
  TCode extends ReceivePolicyErrorCode = ReceivePolicyErrorCode
> extends PolicyOptions<
    ReceivePolicyContext<TEvent, TRuntimeContext, TRoute>,
    "receive",
    TCode
  > {}

type AnyPolicyContract = PolicyContract<string, any, any, any>;

type PolicyContextOf<TPolicy extends AnyPolicyContract> =
  TPolicy extends PolicyContract<string, infer TContext, any, any>
    ? TContext
    : never;

type PolicyScopeOf<TPolicy extends AnyPolicyContract> =
  TPolicy extends PolicyContract<string, any, infer TScope, any> ? TScope : never;

type PolicyCodeOf<TPolicy extends AnyPolicyContract> =
  TPolicy extends PolicyContract<string, any, any, infer TCode> ? TCode : never;

type UnionToIntersection<TValue> = (
  TValue extends unknown ? (value: TValue) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type ComposedPolicyContext<
  TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
> = UnionToIntersection<PolicyContextOf<TPolicies[number]>>;

type ComposedPolicyScope<
  TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
> = PolicyScopeOf<TPolicies[0]>;

type ComposedPolicyCode<
  TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
> = Extract<PolicyCodeOf<TPolicies[number]>, RealtimeErrorCode>;

type SameScopePolicies<
  TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
> = Exclude<PolicyScopeOf<TPolicies[number]>, ComposedPolicyScope<TPolicies>> extends never
  ? TPolicies
  : never;

/**
 * Общие опции policy-composition helper-ов.
 */
export interface PolicyCompositionOptions<
  TScope extends PolicyScope | undefined = undefined
> extends ContractPrimitiveOptions {
  /**
   * Необязательный scope override, который должен совпадать с исходным scope.
   */
  readonly scope?: TScope;
}

/**
 * Создает декларативный policy-примитив и сохраняет evaluator без скрытых
 * адаптеров или оберток.
 */
export function policy<
  TName extends string,
  TContext = unknown,
  TScope extends PolicyScope | undefined = undefined,
  TCode extends RealtimeErrorCode = RealtimeErrorCode
>(
  name: TName,
  options: PolicyOptions<TContext, TScope, TCode>
): PolicyContract<TName, TContext, TScope, TCode> {
  if (typeof options.evaluate !== "function") {
    throw new TypeError("Policy evaluate must be a function.");
  }

  assertPolicyScope(options.scope);

  const baseContract = createPrimitive("policy", name, options);
  const contract = {
    ...baseContract,
    evaluate: options.evaluate
  };

  if (options.scope !== undefined) {
    return deepFreeze({
      ...contract,
      scope: options.scope
    }) as PolicyContract<TName, TContext, TScope, TCode>;
  }

  return deepFreeze(contract) as PolicyContract<TName, TContext, TScope, TCode>;
}

/**
 * Создает connect policy с фиксированным scope `connect`.
 */
export function connectPolicy<
  TName extends string,
  TRuntimeContext = unknown,
  TCode extends ConnectPolicyErrorCode = ConnectPolicyErrorCode
>(
  name: TName,
  options: ConnectPolicyOptions<TRuntimeContext, TCode>
): ConnectPolicyContract<TName, TRuntimeContext, TCode> {
  return policy(name, {
    ...options,
    scope: "connect"
  }) as ConnectPolicyContract<TName, TRuntimeContext, TCode>;
}

/**
 * Создает join policy с фиксированным scope `join`.
 */
export function joinPolicy<
  TName extends string,
  TChannel extends ChannelContract = ChannelContract,
  TRuntimeContext = unknown,
  TCode extends JoinPolicyErrorCode = JoinPolicyErrorCode
>(
  name: TName,
  options: JoinPolicyOptions<TChannel, TRuntimeContext, TCode>
): JoinPolicyContract<TName, TChannel, TRuntimeContext, TCode> {
  return policy(name, {
    ...options,
    scope: "join"
  }) as JoinPolicyContract<TName, TChannel, TRuntimeContext, TCode>;
}

/**
 * Создает command policy с фиксированным scope `command`.
 */
export function commandPolicy<
  TName extends string,
  TCommand extends CommandContract = CommandContract,
  TRuntimeContext = unknown,
  TCode extends CommandPolicyErrorCode = CommandPolicyErrorCode
>(
  name: TName,
  options: CommandPolicyOptions<TCommand, TRuntimeContext, TCode>
): CommandPolicyContract<TName, TCommand, TRuntimeContext, TCode> {
  return policy(name, {
    ...options,
    scope: "command"
  }) as CommandPolicyContract<TName, TCommand, TRuntimeContext, TCode>;
}

/**
 * Создает receive policy с фиксированным scope `receive`.
 */
export function receivePolicy<
  TName extends string,
  TEvent extends EventContract = EventContract,
  TRuntimeContext = unknown,
  TRoute = unknown,
  TCode extends ReceivePolicyErrorCode = ReceivePolicyErrorCode
>(
  name: TName,
  options: ReceivePolicyOptions<TEvent, TRuntimeContext, TRoute, TCode>
): ReceivePolicyContract<TName, TEvent, TRuntimeContext, TRoute, TCode> {
  return policy(name, {
    ...options,
    scope: "receive"
  }) as ReceivePolicyContract<TName, TEvent, TRuntimeContext, TRoute, TCode>;
}

/**
 * Композиция policy через логическое `and` с коротким замыканием на первом deny.
 */
export function andPolicy<
  TName extends string,
  const TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
>(
  name: TName,
  policies: SameScopePolicies<TPolicies>,
  options: PolicyCompositionOptions<ComposedPolicyScope<TPolicies>> = {}
): PolicyContract<
  TName,
  ComposedPolicyContext<TPolicies>,
  ComposedPolicyScope<TPolicies>,
  ComposedPolicyCode<TPolicies>
> {
  const scope = resolveCompositionScope(policies, options.scope);

  return policy(name, {
    ...options,
    scope,
    async evaluate(context: ComposedPolicyContext<TPolicies>) {
      for (const contract of policies) {
        const result = await contract.evaluate(context);

        if (!isPolicyAllowed(result)) {
          return result as PolicyResolution<ComposedPolicyCode<TPolicies>>;
        }
      }

      return true;
    }
  });
}

/**
 * Композиция policy через логическое `or` с коротким замыканием на первом allow.
 */
export function orPolicy<
  TName extends string,
  const TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
>(
  name: TName,
  policies: SameScopePolicies<TPolicies>,
  options: PolicyCompositionOptions<ComposedPolicyScope<TPolicies>> = {}
): PolicyContract<
  TName,
  ComposedPolicyContext<TPolicies>,
  ComposedPolicyScope<TPolicies>,
  ComposedPolicyCode<TPolicies>
> {
  const scope = resolveCompositionScope(policies, options.scope);

  return policy(name, {
    ...options,
    scope,
    async evaluate(context: ComposedPolicyContext<TPolicies>) {
      let firstDeny:
        | PolicyDenyDecision<ComposedPolicyCode<TPolicies>>
        | undefined;

      for (const contract of policies) {
        const result = await contract.evaluate(context);

        if (isPolicyAllowed(result)) {
          return true;
        }

        if (firstDeny === undefined && isPolicyDenyDecision(result)) {
          firstDeny = result as PolicyDenyDecision<ComposedPolicyCode<TPolicies>>;
        }
      }

      return firstDeny ?? false;
    }
  });
}

/**
 * Композиция policy через логическое `not`.
 */
export function notPolicy<
  TName extends string,
  TPolicy extends AnyPolicyContract
>(
  name: TName,
  sourcePolicy: TPolicy,
  options: PolicyCompositionOptions<PolicyScopeOf<TPolicy>> = {}
): PolicyContract<
  TName,
  PolicyContextOf<TPolicy>,
  PolicyScopeOf<TPolicy>,
  PolicyCodeOf<TPolicy>
> {
  const scope = resolveInvertedPolicyScope(sourcePolicy, options.scope);

  return policy(name, {
    ...options,
    scope,
    async evaluate(context: PolicyContextOf<TPolicy>) {
      const result = await sourcePolicy.evaluate(context);

      return isPolicyAllowed(result) ? false : true;
    }
  });
}

function assertPolicyScope(
  scope: string | undefined
): asserts scope is PolicyScope | undefined {
  if (scope === undefined) {
    return;
  }

  if (!POLICY_SCOPE_SET.has(scope as PolicyScope)) {
    throw new TypeError(`Unsupported policy scope: "${scope}".`);
  }
}

function resolveCompositionScope<
  TPolicies extends readonly [AnyPolicyContract, ...AnyPolicyContract[]]
>(
  policies: TPolicies,
  scopeOverride: PolicyScope | undefined
): ComposedPolicyScope<TPolicies> {
  if (policies.length === 0) {
    throw new TypeError("Policy composition requires at least one policy.");
  }

  const firstScope = policies[0].scope;

  for (const contract of policies.slice(1)) {
    if (contract.scope !== firstScope) {
      throw new TypeError(
        `Policy composition requires the same scope for all policies, received "${String(firstScope)}" and "${String(contract.scope)}".`
      );
    }
  }

  if (scopeOverride !== undefined && scopeOverride !== firstScope) {
    throw new TypeError(
      `Policy composition scope override must match the source policy scope, received "${scopeOverride}" and "${String(firstScope)}".`
    );
  }

  return (scopeOverride ?? firstScope) as ComposedPolicyScope<TPolicies>;
}

function resolveInvertedPolicyScope<TPolicy extends AnyPolicyContract>(
  sourcePolicy: TPolicy,
  scopeOverride: PolicyScopeOf<TPolicy> | undefined
): PolicyScopeOf<TPolicy> {
  if (scopeOverride !== undefined && scopeOverride !== sourcePolicy.scope) {
    throw new TypeError(
      `Policy composition scope override must match the source policy scope, received "${String(scopeOverride)}" and "${String(sourcePolicy.scope)}".`
    );
  }

  return (scopeOverride ?? sourcePolicy.scope) as PolicyScopeOf<TPolicy>;
}

function isPolicyAllowed(
  result: PolicyResolution<RealtimeErrorCode>
): boolean {
  if (typeof result === "boolean") {
    return result;
  }

  return result.allowed;
}

function isPolicyDenyDecision(
  result: PolicyResolution<RealtimeErrorCode>
): result is PolicyDenyDecision<RealtimeErrorCode> {
  return typeof result === "object" && result !== null && result.allowed === false;
}

const POLICY_SCOPE_SET = new Set<PolicyScope>(POLICY_SCOPES);
