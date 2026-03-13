import { z } from "zod";

import {
  channel,
  command,
  event,
  policy,
  type ChannelContext,
  type ChannelKey,
  type CommandAck,
  type CommandContext,
  type CommandInput,
  type EventContext,
  type EventPayload,
  type PolicyContext,
  type RuntimeContext
} from "../src/index.js";

/**
 * Проверяет на уровне компиляции, что вывод типов из schema работает для command,
 * event и channel без ручного дублирования payload/input/key shape.
 * Это важно, потому что дальнейшие пакеты должны опираться на один источник истины,
 * а не на отдельно объявленные пользовательские интерфейсы.
 * Дополнительно покрывается corner case с разными input/output типами schema,
 * чтобы база была готова к будущей runtime-валидации.
 */
type ShouldInferContractShapesFromSchemas = Assert<
  IsEqual<
    CommandInput<typeof sendMessageCommand>,
    {
      roomId: string;
      body: string;
    }
  > &
    IsEqual<
      CommandAck<typeof sendMessageCommand>,
      {
        messageId: string;
      }
    > &
    IsEqual<
      EventPayload<typeof messageCreatedEvent>,
      {
        messageId: string;
        body: string;
      }
    > &
    IsEqual<
      ChannelKey<typeof voiceRoomChannel>,
      {
        roomId: string;
      }
    >
>;

/**
 * Проверяет на уровне компиляции, что execution context для command/event/channel/policy
 * собирается из общих типов и сохраняет связь с конкретным контрактом и runtime context.
 * Это важно для будущих server/client слоев, где один и тот же контракт должен
 * давать стабильный shape контекста в policy и handler-ах.
 * Также учитывается corner case со специализированным runtime context, чтобы
 * типовая система не теряла пользовательские поля соединения и сессии.
 */
type ShouldBuildSharedExecutionContexts = Assert<
  IsEqual<
    CommandContext<typeof sendMessageCommand, AppRuntimeContext>,
    {
      readonly contract: typeof sendMessageCommand;
      readonly name: "send-message";
      readonly input: {
        roomId: string;
        body: string;
      };
      readonly context: AppRuntimeContext;
    }
  > &
    IsEqual<
      EventContext<typeof messageCreatedEvent, AppRuntimeContext>,
      {
        readonly contract: typeof messageCreatedEvent;
        readonly name: "message-created";
        readonly payload: {
          messageId: string;
          body: string;
        };
        readonly context: AppRuntimeContext;
      }
    > &
    IsEqual<
      ChannelContext<typeof voiceRoomChannel, AppRuntimeContext>,
      {
        readonly contract: typeof voiceRoomChannel;
        readonly name: "voice-room";
        readonly key: {
          roomId: string;
        };
        readonly context: AppRuntimeContext;
      }
    > &
    IsEqual<
      PolicyContext<typeof membershipPolicy, AppRuntimeContext>,
      {
        readonly contract: typeof membershipPolicy;
        readonly name: "is-member";
        readonly context: AppRuntimeContext;
      }
    >
>;

const sendMessageSchema = z.object({
  roomId: z.string(),
  body: z.string().trim()
});

const sendMessageAckSchema = z.object({
  messageId: z.string()
});

const messageCreatedSchema = z.object({
  messageId: z.string(),
  body: z.string()
});

const voiceRoomKeySchema = z.object({
  roomId: z.string()
});

interface AppRuntimeContext
  extends RuntimeContext<
    {
      socketId: string;
    },
    {
      sessionId: string;
    },
    {
      userId: string;
    }
  > {
  readonly metadata: {
    requestId: string;
  };
}

const sendMessageCommand = command("send-message", {
  input: sendMessageSchema,
  ack: sendMessageAckSchema
});

const messageCreatedEvent = event("message-created", {
  payload: messageCreatedSchema
});

const voiceRoomChannel = channel("voice-room", {
  key: voiceRoomKeySchema
});

const membershipPolicy = policy("is-member", {
  evaluate(context: AppRuntimeContext) {
    return context.user.userId.length > 0;
  }
});

type Assert<T extends true> = T;

type IsEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? true
    : false;
