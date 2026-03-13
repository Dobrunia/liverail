export {
  REALTIME_ERROR_CODES,
  REALTIME_VALIDATION_ERROR_CODES,
  LiveRailRealtimeError,
  createRealtimeError,
  isRealtimeError,
  isRealtimeValidationError,
  normalizeValidationError
} from "./errors/index.ts";
export type {
  CreateRealtimeErrorOptions,
  NormalizeValidationErrorOptions,
  RealtimeErrorCode,
  RealtimeErrorDetails,
  RealtimeErrorPayload,
  RealtimeValidationError,
  RealtimeValidationErrorCode,
  RealtimeValidationErrorDetails,
  RealtimeValidationErrorSource,
  RealtimeValidationIssue
} from "./errors/index.ts";

export type { RuntimeContext } from "./shared/runtime.ts";
export { voidSchema } from "./shared/schema.ts";
export type {
  AnyContractSchema,
  ContractSchema,
  InferSchemaInput,
  InferSchemaOutput,
  ResolveSchemaInput,
  ResolveSchemaOutput
} from "./shared/schema.ts";
export type {
  ContractMetadata,
  ContractPrimitive,
  ContractPrimitiveKind,
  ContractPrimitiveOptions
} from "./shared/primitives.ts";

export {
  SYSTEM_EVENT_NAMES,
  createSystemEvent,
  isSystemEventName
} from "./system/index.ts";
export type {
  SystemConnectionLifecycleState,
  SystemEvent,
  SystemEventName,
  SystemEventPayload,
  SystemEventPayloadMap
} from "./system/index.ts";

export {
  COMMAND_ACK_STATUSES,
  COMMAND_RESULT_STATUSES,
  command,
  parseCommandAck,
  parseCommandInput
} from "./command/index.ts";
export type {
  CommandAckResult,
  CommandAckStatus,
  CommandAckSuccess,
  CommandAck,
  CommandContext,
  CommandContract,
  CommandErrorResult,
  CommandInput,
  CommandResult,
  CommandResultStatus,
  CommandTimeoutResult,
  MissingCommandAck,
  CommandOptions
} from "./command/index.ts";

export { event, parseEventPayload } from "./event/index.ts";
export type {
  EventContext,
  EventContract,
  EventOptions,
  EventPayload
} from "./event/index.ts";

export {
  channel,
  createChannelInstance,
  isSameChannelInstance,
  parseChannelInstance,
  parseChannelKey,
  stringifyChannelInstance
} from "./channel/index.ts";
export type {
  ChannelContext,
  ChannelContract,
  ChannelInstance,
  ChannelKey,
  ChannelOptions
} from "./channel/index.ts";

export {
  POLICY_SCOPES,
  andPolicy,
  commandPolicy,
  connectPolicy,
  joinPolicy,
  notPolicy,
  orPolicy,
  policy,
  receivePolicy
} from "./policy/index.ts";
export type {
  CommandPolicyContext,
  CommandPolicyContract,
  CommandPolicyErrorCode,
  CommandPolicyOptions,
  ConnectPolicyContext,
  ConnectPolicyContract,
  ConnectPolicyErrorCode,
  ConnectPolicyOptions,
  JoinPolicyContext,
  JoinPolicyContract,
  JoinPolicyErrorCode,
  JoinPolicyOptions,
  PolicyAllowDecision,
  PolicyCompositionOptions,
  PolicyContext,
  PolicyDecision,
  PolicyDenyDecision,
  PolicyContract,
  PolicyEvaluator,
  PolicyOptions,
  PolicyResolution,
  PolicyResult,
  PolicyScope,
  ReceivePolicyContext,
  ReceivePolicyContract,
  ReceivePolicyErrorCode,
  ReceivePolicyOptions
} from "./policy/index.ts";

export {
  createContractRegistry,
  defineChannels,
  defineCommands,
  defineEvents,
  definePolicies,
  inspectContractRegistry
} from "./registry/index.ts";
export type {
  AnyContract,
  ContractIntrospectionBucket,
  ContractNames,
  ContractRegistry,
  ContractRegistryIntrospection,
  ContractRegistryBucket,
  ContractRegistryDefinition,
  ContractsByName
} from "./registry/index.ts";
