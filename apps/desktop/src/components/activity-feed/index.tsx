/**
 * ActivityFeed Component (Build Mode)
 *
 * Chronological timeline of agent events for build mode.
 * Shows all events in a flat list with timestamps.
 */

import { For, Show, createMemo, type Component } from "solid-js";
import type {
  AgentEvent,
  ChatMessageMetadata,
  ChatUIMessage,
  ThoughtData,
} from "../../types/ui-message";
import { MessageParts } from "../message-parts";
import { ActionRow } from "./action-row";
import { ThoughtIndicator } from "./thought-indicator";

export interface ActivityFeedProps {
  message: ChatUIMessage;
  metadata?: ChatMessageMetadata;
}

/**
 * Extract all events from message parts
 */
function extractEvents(message: ChatUIMessage): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const part of message.parts) {
    if (part.type === "data-data-action") {
      events.push((part as { type: "data-data-action"; data: AgentEvent }).data);
    }
  }
  return events.sort((a, b) => a.ts - b.ts);
}

/**
 * Extract active thought data if any
 */
function extractThought(message: ChatUIMessage): ThoughtData | null {
  for (const part of message.parts) {
    if (part.type === "data-data-thought") {
      return (part as { type: "data-data-thought"; data: ThoughtData }).data;
    }
  }
  return null;
}

/**
 * Check if message has text content
 */
function hasTextContent(message: ChatUIMessage): boolean {
  return message.parts.some(part => part.type === "text" && part.text.trim());
}

export const ActivityFeed: Component<ActivityFeedProps> = props => {
  const events = createMemo(() => extractEvents(props.message));
  const thought = createMemo(() => extractThought(props.message));
  const showText = createMemo(() => hasTextContent(props.message));

  return (
    <div class="animate-fade-in-up">
      {/* Thought Indicator (if thinking) */}
      <Show when={thought()}>
        <ThoughtIndicator
          status={thought()!.status}
          durationMs={thought()!.durationMs}
          text={thought()!.text}
        />
      </Show>

      {/* Event Timeline */}
      <Show when={events().length > 0}>
        <div class="my-3 space-y-0.5">
          <For each={events()}>{event => <ActionRow event={event} />}</For>
        </div>
      </Show>

      {/* Text Content (markdown response) */}
      <Show when={showText()}>
        <div class="mt-3">
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
      </Show>
    </div>
  );
};

export default ActivityFeed;
