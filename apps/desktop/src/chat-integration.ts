/**
 * Chat Integration Exports
 *
 * Main exports for the desktop-agent chat integration.
 */

// Types
export type {
  ChatState,
  ChatStatus,
  ChatUIMessage,
  PermissionRequestData,
  ProgressData,
  RLMStateData,
  SessionData,
  ToolCallPartData,
  ToolResultPartData,
} from "./types/ui-message";

// API Client
export { EkacodeApiClient, createApiClient } from "./lib/api-client";
export type {
  ApiClientConfig,
  ChatOptions,
  PendingPermission,
  PermissionResponse,
  SessionStatus,
} from "./lib/api-client";

// Chat Store
export { createChatStore } from "./lib/chat/store";
export type { ChatStore } from "./lib/chat/store";

// Stream Parser
export { parseUIMessageStream } from "./lib/chat/stream-parser";
export type { StreamCallbacks } from "./lib/chat/stream-parser";

// Hooks
export { useChat } from "./hooks/use-chat";
export type { UseChatOptions, UseChatResult } from "./hooks/use-chat";

export { usePermissions } from "./hooks/use-permissions";
export type { UsePermissionsOptions, UsePermissionsResult } from "./hooks/use-permissions";

export { useSession } from "./hooks/use-session";
export type { UseSessionOptions, UseSessionResult } from "./hooks/use-session";

// Components
export { MessageParts, TextPart, ToolCallPart, ToolResultPart } from "./components/message-parts";
export { PermissionDialog } from "./components/permission-dialog";
