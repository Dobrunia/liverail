import type { RuntimeContext } from "../shared/runtime.ts";
import { deepFreeze } from "../shared/object.ts";
import {
  createPrimitive,
  type ContractPrimitive,
  type ContractPrimitiveOptions
} from "../shared/primitives.ts";

/**
 * Результат исполнения policy-проверки.
 */
export type PolicyResult = boolean | Promise<boolean>;

/**
 * Функция проверки доступа или иного runtime-условия.
 */
export type PolicyEvaluator<TContext = unknown> = (
  context: TContext
) => PolicyResult;

/**
 * Опции декларативной policy-сущности.
 */
export interface PolicyOptions<TContext = unknown>
  extends ContractPrimitiveOptions {
  /**
   * Проверка, которую должен выполнить runtime.
   */
  readonly evaluate: PolicyEvaluator<TContext>;
}

/**
 * Декларативный контракт policy с прикрепленной функцией проверки.
 */
export interface PolicyContract<
  TName extends string = string,
  TContext = RuntimeContext
> extends ContractPrimitive<"policy", TName> {
  /**
   * Проверка, которую вызывает runtime при оценке policy.
   */
  readonly evaluate: PolicyEvaluator<TContext>;
}

/**
 * Типизированный контекст исполнения policy.
 */
export interface PolicyContext<
  TPolicy extends PolicyContract<string, any> = PolicyContract<string, any>,
  TRuntimeContext extends RuntimeContext = RuntimeContext
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
 * Создает декларативный policy-примитив и сохраняет evaluator без скрытых
 * адаптеров или оберток.
 */
export function policy<TName extends string, TContext = unknown>(
  name: TName,
  options: PolicyOptions<TContext>
): PolicyContract<TName, TContext> {
  if (typeof options.evaluate !== "function") {
    throw new TypeError("Policy evaluate must be a function.");
  }

  const baseContract = createPrimitive("policy", name, options);

  return deepFreeze({
    ...baseContract,
    evaluate: options.evaluate
  }) as PolicyContract<TName, TContext>;
}
