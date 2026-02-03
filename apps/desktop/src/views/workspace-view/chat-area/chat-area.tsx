import Resizable from "@corvu/resizable";
import { Component, createSignal, mergeProps } from "solid-js";
import { ChatHeader } from "./chat-header";
import { ChatInput } from "./chat-input";
import { MessageList } from "./message-list";
import { cn } from "/@/lib/utils";
import type { AgentMode, Session } from "/@/types";
import type { ChatUIMessage } from "/@/types/ui-message";

/**
 * Base message interface for compatibility
 */
interface BaseMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  parts?: unknown[];
}

interface ChatPanelProps {
  /** Current active session */
  session?: Session | { sessionId: string; title: string };
  /** All messages for current session */
  messages?: BaseMessage[] | ChatUIMessage[];
  /** Whether AI is currently generating */
  isGenerating?: boolean;
  /** Current thinking content */
  thinkingContent?: string;
  /** Send message handler */
  onSend?: (content: string) => void;
  /** Attachment handler */
  onAttachment?: () => void;
  /** Mention handler */
  onMention?: () => void;
  /** Mode change handler */
  onModeChange?: (mode: AgentMode) => void;
  /** Model change handler */
  onModelChange?: (modelId: string) => void;
  /** Selected model ID */
  selectedModel?: string;
  /** Initial mode */
  initialMode?: AgentMode;
  /** Additional CSS classes */
  class?: string;
}

/**
 * ChatPanel - Center panel composing the full chat interface
 *
 * Design Features:
 * - Breadcrumb navigation in header
 * - Scrollable message area with auto-scroll
 * - Clean card-style input with mode selector
 * - Smooth transitions between states
 */
export const ChatPanel: Component<ChatPanelProps> = props => {
  const merged = mergeProps(
    {
      messages: [],
      isGenerating: false,
      selectedModel: "claude-sonnet",
      initialMode: "plan" as AgentMode,
    },
    props
  );

  const [inputValue, setInputValue] = createSignal("");
  const [agentMode, setAgentMode] = createSignal<AgentMode>(merged.initialMode);

  const handleSend = () => {
    const content = inputValue().trim();
    if (content && !merged.isGenerating) {
      merged.onSend?.(content);
      setInputValue("");
    }
  };

  const handleModeChange = (mode: AgentMode) => {
    setAgentMode(mode);
    merged.onModeChange?.(mode);
  };

  // Get project name from session (handle both formats)
  const getProjectName = (): string => {
    const session = props.session;
    if (!session) return "Project";
    if ("projectId" in session) return session.projectId ?? "Project";
    return session.title ?? "Project";
  };

  // Generate breadcrumbs from session/project path
  const breadcrumbs = () => {
    const path = getProjectName();
    return path.split("/").map((segment: string, index: number, array: string[]) => ({
      label: segment || "~",
      path: array.slice(0, index + 1).join("/"),
    }));
  };

  // Get placeholder text
  const getPlaceholder = (): string => {
    const messageCount = merged.messages?.length ?? 0;
    return messageCount === 0 ? "Start a conversation about your project..." : "Reply to Agent...";
  };

  return (
    <Resizable.Panel
      initialSize={0.5}
      minSize={0.3}
      class={cn(
        "bg-background animate-fade-in-up flex h-full flex-1 flex-col overflow-visible",
        props.class
      )}
    >
      {/* Header */}
      <ChatHeader
        breadcrumbs={breadcrumbs()}
        projectName={getProjectName()}
        selectedModel={merged.selectedModel}
        onModelChange={props.onModelChange}
      />

      {/* Message list */}
      <MessageList
        messages={merged.messages as BaseMessage[]}
        isGenerating={merged.isGenerating}
        thinkingContent={props.thinkingContent}
      />

      {/* Input area */}
      <ChatInput
        value={inputValue()}
        onValueChange={setInputValue}
        onSend={handleSend}
        onAttachment={props.onAttachment}
        onMention={props.onMention}
        mode={agentMode()}
        onModeChange={handleModeChange}
        selectedModel={merged.selectedModel}
        isSending={merged.isGenerating}
        placeholder={getPlaceholder()}
      />
    </Resizable.Panel>
  );
};
