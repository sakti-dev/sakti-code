/**
 * Chat Provider
 *
 * Provides useChat hook with client to children.
 * Replaces WorkspaceHooksBridge anti-pattern.
 *
 * Part of Phase 5: Hooks Refactor
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <ChatProvider
 *       client={apiClient}
 *       workspace={() => '/path/to/project'}
 *       sessionId={() => activeSessionId}
 *       onSessionIdReceived={(id) => setActiveSessionId(id)}
 *     >
 *       <ChatComponent />
 *     </ChatProvider>
 *   );
 * }
 *
 * function ChatComponent() {
 *   const { chat } = useChatContext();
 *   return <div>{chat.streaming.status()}</div>;
 * }
 * ```
 */

import { useChat } from "@/core/chat/hooks/use-chat";
import type { SaktiCodeApiClient } from "@/core/services/api/api-client";
import { createContext, useContext, type Accessor, type JSX, type ParentComponent } from "solid-js";

/**
 * Chat context value
 */
interface ChatContextValue {
  /** Chat hook result */
  chat: ReturnType<typeof useChat>;
}

/**
 * Chat context
 */
const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Props for ChatProvider component
 */
interface ChatProviderProps {
  /** API client for making chat requests */
  client: SaktiCodeApiClient;

  /** Workspace directory accessor */
  workspace: Accessor<string>;

  /** Session ID accessor */
  sessionId: Accessor<string | null>;

  /** Called when session ID is received/updated */
  onSessionIdReceived?: (sessionId: string) => void;
  /** Selected provider id accessor */
  providerId?: Accessor<string | null | undefined>;
  /** Selected model id accessor */
  modelId?: Accessor<string | null | undefined>;
  /** Optional runtime mode accessor for chat behavior */
  runtimeMode?: Accessor<"intake" | "plan" | "build" | undefined>;

  /** Called on error */
  onError?: (error: Error) => void;

  /** Called when message finishes */
  onFinish?: (messageId: string) => void;

  /** Child components */
  children: JSX.Element;
}

/**
 * Provider component that wraps children with chat functionality
 *
 * Uses useChat internally to provide chat state and operations to children.
 * This replaces the WorkspaceHooksBridge anti-pattern.
 */
export const ChatProvider: ParentComponent<ChatProviderProps> = props => {
  const chat = useChat({
    client: props.client,
    workspace: props.workspace,
    sessionId: props.sessionId,
    onSessionIdReceived: props.onSessionIdReceived,
    providerId: props.providerId,
    modelId: props.modelId,
    runtimeMode: props.runtimeMode,
    onError: props.onError,
    onFinish: props.onFinish,
  });

  return <ChatContext.Provider value={{ chat }}>{props.children}</ChatContext.Provider>;
};

/**
 * Hook to access chat context
 *
 * @throws Error if used outside ChatProvider
 * @returns Chat context value
 */
export function useChatContext(): ChatContextValue {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within ChatProvider");
  }
  return context;
}
