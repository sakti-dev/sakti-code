import type { Part as CorePart } from "@ekacode/core/chat";
import { AssistantMessage } from "@renderer/components/assistant-message";
import { Markdown } from "@renderer/components/markdown";
import { cn } from "@renderer/lib/utils";
import type { ChatMessage } from "@renderer/presentation/hooks/use-messages";
import { useMessages } from "@renderer/presentation/hooks/use-messages";
import type { Message as SyncMessage } from "@renderer/types/sync";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
  type Component,
} from "solid-js";
import { MessageBubble } from "./message-bubble";

interface SessionTurnProps {
  sessionID?: string;
  /** User message ID - component fetches data from store */
  messageID: string;
  /** Whether this turn is the last (for expanded state) */
  isLast?: boolean;
  isGenerating?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  class?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapError(input: string): string {
  const text = input.replace(/^Error:\s*/, "").trim();
  const parse = (value: string) => {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  };
  const read = (value: string) => {
    const first = parse(value);
    if (typeof first !== "string") return first;
    return parse(first.trim());
  };

  let json = read(text);
  if (json === undefined) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      json = read(text.slice(start, end + 1));
    }
  }
  if (!isRecord(json)) return text;

  const error = isRecord(json.error) ? json.error : undefined;
  if (error) {
    const type = typeof error.type === "string" ? error.type : undefined;
    const message = typeof error.message === "string" ? error.message : undefined;
    if (type && message) return `${type}: ${message}`;
    if (message) return message;
    if (type) return type;
    const code = typeof error.code === "string" ? error.code : undefined;
    if (code) return code;
  }
  if (typeof json.message === "string") return json.message;
  if (typeof json.error === "string") return json.error;
  return text;
}

function computeStatusFromPart(part: CorePart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return "Delegating task";
      case "todowrite":
      case "todoread":
        return "Planning";
      case "read":
        return "Gathering context";
      case "list":
      case "grep":
      case "glob":
        return "Searching codebase";
      case "webfetch":
        return "Searching web";
      case "edit":
      case "write":
      case "apply_patch":
        return "Making edits";
      case "bash":
        return "Running commands";
      default:
        return undefined;
    }
  }
  if (part.type === "reasoning") {
    const text = part.text ?? "";
    const match = text.trimStart().match(/^\*\*(.+?)\*\*/);
    if (match?.[1]) return `Thinking: ${match[1].trim()}`;
    return "Thinking";
  }
  if (part.type === "text") {
    return "Gathering thoughts";
  }
  return undefined;
}

function formatDuration(input: { from?: number; to?: number }): string {
  const from = input.from ?? Date.now();
  const to = input.to ?? Date.now();
  const seconds = Math.max(0, Math.round((to - from) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function lastTextPart(messages: ChatMessage[]): { id?: string; text: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let p = msg.parts.length - 1; p >= 0; p--) {
      const part = msg.parts[p] as unknown as CorePart;
      if (part.type !== "text") continue;
      const text = typeof part.text === "string" ? part.text.trim() : "";
      if (text) {
        return {
          id: part.id,
          text,
        };
      }
    }
  }
  return { text: "" };
}

function hasToolSteps(messages: ChatMessage[]): boolean {
  return messages.some(message => {
    return message.parts.some(part => part.type === "tool");
  });
}

function nextUserMessageIndex(messages: ChatMessage[], fromIndex: number): number {
  for (let i = fromIndex + 1; i < messages.length; i++) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

export function selectAssistantMessagesForTurn(
  allMessages: ChatMessage[],
  userMessageID: string
): ChatMessage[] {
  const userIndex = allMessages.findIndex(msg => msg.id === userMessageID && msg.role === "user");
  if (userIndex === -1) return [];

  // Prefer explicit parent linkage when available.
  const linked = allMessages.filter(
    msg => msg.role === "assistant" && msg.parentId === userMessageID
  );
  if (linked.length > 0) return linked;

  // Fallback: assistants between this user turn and the next user turn.
  const nextUserIndex = nextUserMessageIndex(allMessages, userIndex);
  const window =
    nextUserIndex === -1
      ? allMessages.slice(userIndex + 1)
      : allMessages.slice(userIndex + 1, nextUserIndex);
  return window.filter(msg => msg.role === "assistant");
}

export const SessionTurn: Component<SessionTurnProps> = props => {
  const messages = useMessages(() => props.sessionID ?? null);

  const [statusText, setStatusText] = createSignal("Considering next steps");
  const [durationText, setDurationText] = createSignal("0s");
  const [copied, setCopied] = createSignal(false);

  let lastStatusAt = Date.now();
  let statusTimer: ReturnType<typeof setTimeout> | undefined;

  // Get user message for this turn - convert to SyncMessage format for MessageBubble
  const userMessage = createMemo((): SyncMessage | undefined => {
    const msg = messages.get(props.messageID);
    if (!msg) return undefined;

    // Convert ChatMessage to SyncMessage format for MessageBubble
    return {
      info: {
        role: msg.role,
        id: msg.id,
        sessionID: msg.sessionId,
        time: { created: msg.createdAt ?? Date.now() },
      },
      parts: msg.parts as SyncMessage["parts"],
      createdAt: msg.createdAt,
      updatedAt: msg.completedAt,
    };
  });

  // Get assistant messages that respond to this user message
  const assistantMessages = createMemo(() => {
    return selectAssistantMessagesForTurn(messages.list(), props.messageID);
  });

  // Compute derived state
  const responsePart = createMemo(() => lastTextPart(assistantMessages()));
  const responseText = createMemo(() => responsePart().text);
  const responsePartID = createMemo(() => responsePart().id);
  const hasToolStepsVal = createMemo(() => hasToolSteps(assistantMessages()));
  const showTrigger = createMemo(() => (props.isLast && props.isGenerating) || hasToolStepsVal());
  const lastAssistantID = createMemo(() => assistantMessages().at(-1)?.id);
  const hideResponsePart = createMemo(
    () => !props.isLast && !props.isGenerating && !!responsePartID()
  );

  const durationRange = createMemo(() => {
    const user = userMessage();
    const lastAssistant = assistantMessages().at(-1);
    const from = user?.createdAt;
    const to = lastAssistant?.completedAt;
    return { from, to };
  });

  // Find the last part with status information
  const rawStatus = createMemo(() => {
    for (const message of assistantMessages().slice().reverse()) {
      for (const p of message.parts.slice().reverse()) {
        const status = computeStatusFromPart(p as unknown as CorePart);
        if (status) return status;
      }
    }

    // Fall back to parsing final response text for surfaced error messages.
    const text = responseText().trim();
    if (text.toLowerCase().startsWith("error:")) {
      return unwrapError(text);
    }

    return "Considering next steps";
  });

  createEffect(() => {
    const update = () => {
      const range = durationRange();
      const to = props.isLast && props.isGenerating ? Date.now() : range.to;
      setDurationText(formatDuration({ from: range.from, to }));
    };
    update();
    if (!props.isLast || !props.isGenerating) return;
    const timer = setInterval(update, 1000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(() => {
    const nextStatus = rawStatus();
    if (!nextStatus || nextStatus === statusText()) return;
    const elapsed = Date.now() - lastStatusAt;
    if (elapsed >= 2500) {
      setStatusText(nextStatus);
      lastStatusAt = Date.now();
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = undefined;
      }
      return;
    }
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      setStatusText(nextStatus);
      lastStatusAt = Date.now();
      statusTimer = undefined;
    }, 2500 - elapsed);
  });

  onCleanup(() => {
    if (statusTimer) clearTimeout(statusTimer);
  });

  const handleCopy = async () => {
    const text = responseText();
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Show when={userMessage()}>
      {user => (
        <div class={cn("mb-6", props.class)}>
          <MessageBubble message={user()} />

          <Show when={showTrigger()}>
            <div class="mt-2 flex justify-start">
              <button
                class={cn(
                  "bg-card/30 border-border/30 hover:bg-card/50 rounded-lg border px-3 py-1.5 text-xs",
                  "text-muted-foreground inline-flex items-center gap-2 transition-colors"
                )}
                onClick={props.onToggleExpanded}
                aria-expanded={props.expanded}
              >
                <Switch>
                  <Match when={props.isLast && props.isGenerating}>
                    <span class="bg-primary/70 inline-block h-2 w-2 animate-pulse rounded-full" />
                  </Match>
                  <Match when={!props.expanded}>
                    <span>▽</span>
                  </Match>
                  <Match when={props.expanded}>
                    <span>△</span>
                  </Match>
                </Switch>

                <Switch>
                  <Match when={props.isLast && props.isGenerating}>
                    <span>{statusText()}</span>
                  </Match>
                  <Match when={props.expanded}>
                    <span>Hide steps</span>
                  </Match>
                  <Match when={!props.expanded}>
                    <span>Show steps</span>
                  </Match>
                </Switch>

                <span aria-hidden="true">·</span>
                <span aria-live="off">{durationText()}</span>
              </button>
            </div>
          </Show>

          <Show when={props.expanded && assistantMessages().length > 0}>
            <div class="mt-3 space-y-3" aria-hidden={props.isLast && props.isGenerating}>
              <For each={assistantMessages()}>
                {assistant => (
                  <AssistantMessage
                    messageID={assistant.id}
                    sessionID={props.sessionID}
                    fallbackParts={assistant.parts as import("@renderer/types/sync").Part[]}
                    hideSummary
                    hideReasoning={!props.isLast || !props.isGenerating}
                    hideFinalTextPart={
                      hideResponsePart() &&
                      !props.isGenerating &&
                      assistant.id === lastAssistantID()
                    }
                  />
                )}
              </For>
            </div>
          </Show>

          <div class="sr-only" aria-live="polite">
            {!props.isGenerating && responseText() ? responseText() : ""}
          </div>
          <Show when={!props.isGenerating && responseText()}>
            <div class="border-border/30 bg-card/30 mt-3 rounded-xl border px-4 py-3">
              <div class="mb-2 flex items-center justify-between">
                <div class="text-muted-foreground text-xs font-medium">Response</div>
                <button
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => {
                    event.stopPropagation();
                    void handleCopy();
                  }}
                  class="bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 rounded px-2 py-1 text-xs"
                  aria-label={copied() ? "Copied" : "Copy"}
                >
                  {copied() ? "Copied" : "Copy"}
                </button>
              </div>
              <Markdown text={responseText()} class="prose-p:m-0" />
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

export default SessionTurn;
