import type { Part as CorePart, ToolPart } from "@ekacode/core/chat";
import { usePart } from "@renderer/presentation/contexts/part-context";
import { createMemo, For, Show, type Component, type JSX } from "solid-js";
import type { Part } from "../types/sync";
import { Markdown } from "./markdown";
import { Part as PartComponent } from "./message-part";

export interface AssistantMessageProps {
  /** Message ID - component fetches parts from store */
  messageID: string;
  /** Session ID for store lookup */
  sessionID?: string;
  /** Fallback parts from message object if store parts are empty */
  fallbackParts?: Part[];
  hideSummary?: boolean;
  hideReasoning?: boolean;
  hideFinalTextPart?: boolean;
  hidden?: ReadonlyArray<{ messageID: string; callID: string }>;
}

const INTERNAL_TOOLS = new Set(["todoread"]);

export const AssistantMessage: Component<AssistantMessageProps> = props => {
  const part = usePart();

  // Fetch parts from store, falling back to embedded parts from message
  const parts = createMemo(() => {
    const storeParts = part.getByMessage(props.messageID);
    if (storeParts && storeParts.length > 0) {
      return storeParts as unknown as CorePart[];
    }
    // Fall back to parts passed from parent (embedded in message)
    return (props.fallbackParts ?? []) as unknown as CorePart[];
  });

  // Create a minimal message info for Part component
  const messageInfo = createMemo(
    () =>
      ({
        info: {
          role: "assistant" as const,
          id: props.messageID,
        },
        parts: parts(),
        createdAt: Date.now(),
      }) as import("@ekacode/core/chat").Message
  );

  return (
    <AssistantMessageDisplay
      message={messageInfo()}
      parts={parts()}
      hideSummary={props.hideSummary}
      hideReasoning={props.hideReasoning}
      hideFinalTextPart={props.hideFinalTextPart}
      hidden={props.hidden}
    />
  );
};

export default AssistantMessage;

/**
 * Opencode-like rendering:
 * - show operational parts (reasoning/tool/step/patch/snapshot) in order
 * - if operational parts exist, show final text separately as the response block
 */
export function AssistantMessageDisplay(props: {
  message: import("@ekacode/core/chat").Message;
  parts: import("@ekacode/core/chat").Part[];
  hideSummary?: boolean;
  hideReasoning?: boolean;
  hideFinalTextPart?: boolean;
  hidden?: ReadonlyArray<{ messageID: string; callID: string }>;
}): JSX.Element {
  const filteredParts = createMemo(() => {
    let parts = props.parts.filter(
      part => part.type !== "tool" || !INTERNAL_TOOLS.has((part as ToolPart).tool)
    );
    if (props.hideReasoning) {
      parts = parts.filter(part => part.type !== "reasoning");
    }
    const hidden = props.hidden ?? [];
    if (hidden.length > 0) {
      parts = parts.filter(part => {
        if (part.type !== "tool") return true;
        const callID = (part as ToolPart).callID;
        if (!callID) return true;
        return !hidden.some(
          item => item.messageID === props.message.info.id && item.callID === callID
        );
      });
    }
    return parts;
  });

  const hasOperationalParts = createMemo(() =>
    filteredParts().some(part => part.type !== "text" && part.type !== "reasoning")
  );

  const lastTextPart = createMemo(() => {
    const parts = filteredParts();
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      if (part.type !== "text") continue;
      return part as import("@ekacode/core/chat").TextPart;
    }
    return undefined;
  });

  const visibleParts = createMemo(() => {
    const responseId = lastTextPart()?.id;
    if (!responseId) return filteredParts();

    // Summary view: hide response text from inline stream and render as summary block below.
    if (!props.hideSummary && hasOperationalParts()) {
      return filteredParts().filter(part => part.id !== responseId);
    }

    // Expanded steps view: optionally hide the final response text part.
    if (props.hideFinalTextPart) {
      return filteredParts().filter(part => part.id !== responseId);
    }

    return filteredParts();
  });

  const responseText = createMemo(() => {
    const part = lastTextPart();
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    return text;
  });

  return (
    <div data-component="assistant-message" class="flex flex-col gap-2">
      <For each={visibleParts()}>
        {part => (
          <PartComponent part={part as import("@ekacode/core/chat").Part} message={props.message} />
        )}
      </For>

      <Show when={!props.hideSummary && hasOperationalParts() && responseText()}>
        <div
          data-slot="assistant-response"
          class="bg-card/30 border-border/30 rounded-xl border px-4 py-3"
        >
          <Markdown text={responseText()} class="prose-p:m-0" />
        </div>
      </Show>
    </div>
  );
}
