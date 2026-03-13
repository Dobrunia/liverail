import {
  stringifyChannelInstance,
  type ChannelContract,
  type ChannelKey
} from "@liverail/contracts";

/**
 * Активная клиентская подписка на конкретный channel instance.
 */
export interface ClientChannelSubscription<
  TChannel extends ChannelContract = ChannelContract
> {
  /**
   * Контракт канала, на который оформлена подписка.
   */
  readonly contract: TChannel;

  /**
   * Имя channel template.
   */
  readonly name: TChannel["name"];

  /**
   * Нормализованный ключ конкретного channel instance.
   */
  readonly key: ChannelKey<TChannel>;

  /**
   * Канонический идентификатор конкретного channel instance.
   */
  readonly id: string;
}

/**
 * Создает стабильный ключ хранения локальной подписки.
 */
export function getClientChannelSubscriptionKey(
  channelName: string,
  key: ChannelKey<ChannelContract>
): string {
  return stringifyChannelInstance(channelName, key);
}
