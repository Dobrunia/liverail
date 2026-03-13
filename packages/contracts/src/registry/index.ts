import type { ChannelContract } from "../channel/index.ts";
import type { CommandContract } from "../command/index.ts";
import type { EventContract } from "../event/index.ts";
import type { PolicyContract } from "../policy/index.ts";
import { deepFreeze } from "../shared/object.ts";

/**
 * Любой поддерживаемый контракт, который можно поместить в registry.
 */
export type AnyContract =
  | CommandContract
  | EventContract
  | ChannelContract
  | PolicyContract<string, any>;

/**
 * Отображение набора контрактов в lookup-объект по их именам.
 */
export type ContractsByName<TContracts extends readonly AnyContract[]> = {
  readonly [TContract in TContracts[number] as TContract["name"]]: TContract;
};

/**
 * Детерминированная коллекция контрактов одного вида.
 */
export interface ContractRegistryBucket<
  TContracts extends readonly AnyContract[] = readonly AnyContract[]
> {
  /**
   * Контракты в порядке их явной регистрации.
   */
  readonly list: TContracts;

  /**
   * Прямой lookup контрактов по имени.
   */
  readonly byName: ContractsByName<TContracts>;
}

/**
 * Входные данные для явного построения registry.
 */
export interface ContractRegistryDefinition<
  TCommands extends readonly CommandContract[] = readonly CommandContract[],
  TEvents extends readonly EventContract[] = readonly EventContract[],
  TChannels extends readonly ChannelContract[] = readonly ChannelContract[],
  TPolicies extends readonly PolicyContract<string, any>[] = readonly PolicyContract<
    string,
    any
  >[]
> {
  /**
   * Набор зарегистрированных команд.
   */
  readonly commands?: TCommands;

  /**
   * Набор зарегистрированных серверных событий.
   */
  readonly events?: TEvents;

  /**
   * Набор зарегистрированных каналов.
   */
  readonly channels?: TChannels;

  /**
   * Набор зарегистрированных policy-контрактов.
   */
  readonly policies?: TPolicies;
}

/**
 * Единая детерминированная registry-модель всех contracts проекта.
 */
export interface ContractRegistry<
  TCommands extends readonly CommandContract[] = readonly CommandContract[],
  TEvents extends readonly EventContract[] = readonly EventContract[],
  TChannels extends readonly ChannelContract[] = readonly ChannelContract[],
  TPolicies extends readonly PolicyContract<string, any>[] = readonly PolicyContract<
    string,
    any
  >[]
> {
  /**
   * Коллекция command-контрактов.
   */
  readonly commands: ContractRegistryBucket<TCommands>;

  /**
   * Коллекция event-контрактов.
   */
  readonly events: ContractRegistryBucket<TEvents>;

  /**
   * Коллекция channel-контрактов.
   */
  readonly channels: ContractRegistryBucket<TChannels>;

  /**
   * Коллекция policy-контрактов.
   */
  readonly policies: ContractRegistryBucket<TPolicies>;
}

/**
 * Создает неизменяемый typed tuple command-контрактов без ручного `as const`.
 */
export function defineCommands<
  const TCommands extends readonly CommandContract[]
>(...commands: TCommands): TCommands {
  return Object.freeze([...commands]) as TCommands;
}

/**
 * Создает неизменяемый typed tuple event-контрактов без ручного `as const`.
 */
export function defineEvents<
  const TEvents extends readonly EventContract[]
>(...events: TEvents): TEvents {
  return Object.freeze([...events]) as TEvents;
}

/**
 * Создает неизменяемый typed tuple channel-контрактов без ручного `as const`.
 */
export function defineChannels<
  const TChannels extends readonly ChannelContract[]
>(...channels: TChannels): TChannels {
  return Object.freeze([...channels]) as TChannels;
}

/**
 * Создает неизменяемый typed tuple policy-контрактов без ручного `as const`.
 */
export function definePolicies<
  const TPolicies extends readonly PolicyContract<string, any>[]
>(...policies: TPolicies): TPolicies {
  return Object.freeze([...policies]) as TPolicies;
}

/**
 * Создает явную registry-модель контрактов без скрытого глобального состояния.
 */
export function createContractRegistry<
  TCommands extends readonly CommandContract[] = readonly [],
  TEvents extends readonly EventContract[] = readonly [],
  TChannels extends readonly ChannelContract[] = readonly [],
  TPolicies extends readonly PolicyContract<string, any>[] = readonly []
>(
  definition: ContractRegistryDefinition<
    TCommands,
    TEvents,
    TChannels,
    TPolicies
  > = {}
): ContractRegistry<TCommands, TEvents, TChannels, TPolicies> {
  const commands = createRegistryBucket(
    (definition.commands ?? []) as TCommands,
    "command",
    "commands"
  );
  const events = createRegistryBucket(
    (definition.events ?? []) as TEvents,
    "event",
    "events"
  );
  const channels = createRegistryBucket(
    (definition.channels ?? []) as TChannels,
    "channel",
    "channels"
  );
  const policies = createRegistryBucket(
    (definition.policies ?? []) as TPolicies,
    "policy",
    "policies"
  );

  return deepFreeze({
    commands,
    events,
    channels,
    policies
  }) as ContractRegistry<TCommands, TEvents, TChannels, TPolicies>;
}

function createRegistryBucket<
  TContract extends AnyContract,
  TContracts extends readonly TContract[]
>(
  contracts: TContracts,
  expectedKind: TContract["kind"],
  bucketName: string
): ContractRegistryBucket<TContracts> {
  const list = Object.freeze([...contracts]) as TContracts;
  const byName = Object.create(null) as Record<string, TContract>;

  for (const contract of list) {
    if (contract.kind !== expectedKind) {
      throw new TypeError(
        `Expected ${expectedKind} contract in ${bucketName} registry bucket, received ${contract.kind}: ${contract.name}.`
      );
    }

    if (Object.hasOwn(byName, contract.name)) {
      throw new TypeError(
        `Duplicate ${expectedKind} contract name: ${contract.name}.`
      );
    }

    byName[contract.name] = contract;
  }

  return deepFreeze({
    list,
    byName: byName as unknown as ContractsByName<TContracts>
  }) as unknown as ContractRegistryBucket<TContracts>;
}
