import { TbOutlineChevronRight } from "solid-icons/tb";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { getUserText } from "~/stores/session/turn-projection";
import type { MessagePart, UIMessage } from "~/stores/types.ts";
import { CHAT_COMPACT_STACK_GAP_CLASS, CHAT_STACK_GAP_CLASS } from "../layout";
import { Part } from "../parts/message-part";
import { PartFooter } from "../parts/part-footer";

export interface SessionTurnProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turn: Accessor<ChatTurn>;
}

function getPartCopyText(part: MessagePart): string | undefined {
  if (part.type === "text") {
    return part.text || undefined;
  }
  if (part.type === "thinking") {
    return part.text || undefined;
  }
  if (part.type === "tool_call") {
    return typeof part.result === "string" && part.result ? part.result : undefined;
  }
  return;
}

function formatWorkDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function MessageContent(msg: UIMessage, isStreaming: boolean): JSX.Element {
  return (
    <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
      <Index each={msg.parts}>
        {(part) => (
          <div class="flex flex-col gap-1">
            <Part isStreaming={isStreaming} part={part()} />
            <Show when={!part().isStreaming}>
              <PartFooter copyText={getPartCopyText(part())} timestamp={msg.timestamp} />
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}

export function SessionTurn(props: SessionTurnProps): JSX.Element {
  const turn = props.turn;
  const [liveMs, setLiveMs] = createSignal(0);
  const [expanded, setExpanded] = createSignal(false);

  createEffect(() => {
    const startedAt = turn().startedAt;
    const endedAt = turn().endedAt;
    if (startedAt === null || endedAt !== null) {
      setLiveMs(0);
      return;
    }
    setLiveMs(Math.max(0, Date.now() - startedAt));
    const timer = setInterval(() => {
      setLiveMs(Math.max(0, Date.now() - startedAt));
    }, 1000);
    onCleanup(() => clearInterval(timer));
  });

  createEffect(
    on(
      () => turn().endedAt,
      (endedAt) => {
        setExpanded(endedAt === null);
      },
    ),
  );

  const durationLabel = createMemo(() => {
    const { startedAt, endedAt } = turn();
    if (startedAt === null) {
      return null;
    }
    if (endedAt !== null) {
      return formatWorkDuration(endedAt - startedAt);
    }
    return formatWorkDuration(liveMs());
  });

  const canCollapse = createMemo(() => {
    const t = turn();
    return t.endedAt !== null && !t.error && t.assistantMessages.length > 1;
  });

  const intermediateMessages = createMemo(() => {
    const msgs = turn().assistantMessages;
    if (msgs.length <= 1) {
      return [];
    }
    return msgs.slice(0, -1);
  });

  const summaryMessage = createMemo(() => {
    const msgs = turn().assistantMessages;
    return msgs.at(-1) ?? null;
  });

  return (
    <div
      class={props.class}
      classList={{ [CHAT_STACK_GAP_CLASS]: true, "@container": true }}
      data-component="session-turn"
      data-slot="session-turn-root"
    >
      <Show when={turn().userMessage}>
        <div class="flex flex-col items-end gap-1 px-3" data-slot="session-turn-user">
          <div class="@2xl:max-w-[450px] @4xl:max-w-[800px] max-w-[80%] rounded-2xl rounded-br-none bg-primary px-4 py-2 text-primary-foreground text-sm">
            <div class="mb-1 font-medium text-primary-foreground/70 text-xs">You</div>
            {getUserText(turn())}
          </div>
          <PartFooter
            copyText={getUserText(turn()) || undefined}
            timestamp={turn().userMessage?.timestamp ?? Date.now()}
          />
        </div>
      </Show>

      <Show when={durationLabel()}>
        <button
          class="flex w-full items-center gap-2 border-border/50 border-b px-3 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted/30 disabled:cursor-default disabled:hover:bg-transparent"
          data-slot="turn-header"
          disabled={!canCollapse()}
          onClick={() => setExpanded((e) => !e)}
          type="button"
        >
          <Show when={canCollapse()}>
            <TbOutlineChevronRight
              class="h-3 w-3 shrink-0 transition-transform duration-200"
              classList={{ "rotate-90": expanded() }}
            />
          </Show>
          <Show when={turn().endedAt === null}>
            <div class="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </Show>
          <span>
            {turn().endedAt === null ? "Working for " : "Worked for "}
            {durationLabel()}
          </span>
        </button>
      </Show>

      {/* Can't collapse (streaming, replay, error, single msg): show ALL messages */}
      <Show when={!canCollapse() && turn().assistantMessages.length > 0}>
        <div
          class="flex flex-col gap-3 px-3 [overflow-anchor:none]"
          data-slot="session-turn-stream"
        >
          <Show when={turn().error && !turn().working}>
            <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">
              {turn().error}
            </div>
          </Show>
          <For each={turn().assistantMessages}>
            {(msg) => MessageContent(msg, props.isStreaming())}
          </For>
        </div>
      </Show>

      {/* Collapsible: accordion intermediate + always-visible summary */}
      <Show when={canCollapse()}>
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{
            "grid-template-rows": expanded() ? "1fr" : "0fr",
          }}
        >
          <div class="min-h-0 overflow-hidden">
            <div class="flex flex-col gap-3 px-3 py-2 opacity-50 [overflow-anchor:none]">
              <For each={intermediateMessages()}>
                {(msg) => MessageContent(msg, props.isStreaming())}
              </For>
            </div>
          </div>
        </div>

        <Show when={summaryMessage()}>
          {(msg) => (
            <div
              class="flex flex-col gap-3 px-3 [overflow-anchor:none]"
              data-slot="session-turn-stream"
            >
              {MessageContent(msg(), props.isStreaming())}
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
