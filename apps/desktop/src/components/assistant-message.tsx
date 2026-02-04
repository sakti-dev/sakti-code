/**
 * AssistantMessage Component (Mode Router)
 *
 * Routes assistant messages to the appropriate UI based on mode:
 * - planning: RunCard component (aggregated view)
 * - build: ActivityFeed component (chronological timeline)
 * - chat: Standard message bubble (default)
 */

import { Match, Switch, type Component } from "solid-js";
import type { AgentMode, ChatMessageMetadata, ChatUIMessage } from "../types/ui-message";
import { ActivityFeed } from "./activity-feed/index";
import { MessageParts } from "./message-parts";
import { RunCard } from "./run-card/index";

export interface AssistantMessageProps {
  message: ChatUIMessage;
  metadata?: ChatMessageMetadata;
}

/**
 * Get the mode from message metadata, defaulting to "chat"
 */
function getMode(metadata?: ChatMessageMetadata): AgentMode {
  return metadata?.mode ?? "chat";
}

/**
 * AssistantMessage - Routes to the appropriate UI based on mode
 */
export const AssistantMessage: Component<AssistantMessageProps> = props => {
  const mode = () => getMode(props.metadata);

  return (
    <Switch fallback={<ChatMessageView message={props.message} />}>
      <Match when={mode() === "planning"}>
        <RunCard message={props.message} metadata={props.metadata} />
      </Match>
      <Match when={mode() === "build"}>
        <ActivityFeed message={props.message} metadata={props.metadata} />
      </Match>
    </Switch>
  );
};

/**
 * Default chat message view (standard bubbles)
 */
const ChatMessageView: Component<{ message: ChatUIMessage }> = props => {
  return (
    <div class="flex gap-3">
      {/* Assistant avatar placeholder */}
      <div class="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
        <span class="text-primary text-xs font-medium">AI</span>
      </div>

      {/* Message content */}
      <div class="min-w-0 flex-1">
        <MessageParts
          parts={
            props.message.parts as readonly {
              type: string;
              text?: string;
              [key: string]: unknown;
            }[]
          }
        />
      </div>
    </div>
  );
};

export default AssistantMessage;
