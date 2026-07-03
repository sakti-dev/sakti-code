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
import type { Turn } from "~/stores/types";

import { useStore } from "~/stores/store-context";
import type { MessagePart, UIMessage } from "~/stores/types.ts";
import { createLogger } from "~/lib/utils";
import { formatDuration } from "~/lib/format-duration";
import { Markdown } from "~/components/ui/markdown";
import { CHAT_COMPACT_STACK_GAP_CLASS, CHAT_STACK_GAP_CLASS } from "../layout";
import { Part, resolvePartStreaming } from "../parts/message-part";
import { PartFooter } from "../parts/part-footer";
import { type ThinkingPart, getNonThinkingParts, getThinkingParts } from "./thinking-helpers.ts";

export interface ThinkingBlockProps {
  part: ThinkingPart;
}

/**
 * Renders a single thinking block as plain muted text inside a scrollable
 * container. Auto-scrolls to follow new tokens while the part is streaming.
 */
export function ThinkingBlock(props: ThinkingBlockProps): JSX.Element {
  const text = () => props.part.text;
  const isActive = () => props.part.isStreaming === true;

  const [contentEl, setContentEl] = createSignal<HTMLDivElement | null>(null);
  let userAtBottom = true;

  const handleScroll = () => {
    const el = contentEl();
    if (!el) {
      return;
    }
    userAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  createEffect(() => {
    text();
    if (!isActive()) {
      return;
    }
    requestAnimationFrame(() => {
      const el = contentEl();
      if (el && userAtBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  });

  onCleanup(() => setContentEl(null));

  return (
    <div
      class="max-h-[200px] overflow-y-auto rounded-lg bg-muted/30 px-4 py-2.5 italic leading-relaxed text-muted-foreground text-sm"
      data-slot="thinking-block"
      onScroll={handleScroll}
      ref={setContentEl}
    >
      <Markdown class="prose-p:m-0" isStreaming={isActive()} text={text()} />
    </div>
  );
}

export interface SessionTurnProps {
  class?: string;
  /** Called when this turn's height changes (intermediates loaded/evicted). */
  onHeightChanged?: () => void;
  sessionId: string;
  turn: Accessor<Turn>;
}

function getUserText(turn: Turn): string {
  return turn.userMessage?.content ?? "";
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

function MessageContent(msg: UIMessage): JSX.Element {
  return (
    <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
      <Index each={getNonThinkingParts(msg.parts)}>
        {(part) => (
          <div class="flex flex-col gap-1">
            <Part isStreaming={resolvePartStreaming(part(), msg.isStreaming)} part={part()} />
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
  const { actions } = useStore();
  const log = createLogger({ module: "SessionTurn" });
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

  // Auto-collapse ONLY when a streaming turn finishes (endedAt null → non-null).
  // defer: true so loaded history turns (endedAt always non-null) don't trigger.
  createEffect(
    on(
      () => turn().endedAt,
      (endedAt, prevEndedAt) => {
        if (endedAt !== null && prevEndedAt === null) {
          log.debug("auto-collapse: turn finished", {
            endedAt,
            turnId: turn().turnId,
          });
          setExpanded(false);
          const tid = turn().turnId;
          if (tid) {
            actions.evictIntermediates(props.sessionId, tid);
          }
        }
      },
      { defer: true },
    ),
  );

  const handleToggle = () => {
    const tid = turn().turnId;
    const wasExpanded = expanded();
    log.info("toggle clicked", {
      turnId: tid,
      wasExpanded,
      endedAt: turn().endedAt,
      msgCount: turn().messages.length,
    });
    setExpanded(!wasExpanded);
    if (tid) {
      if (!wasExpanded) {
        void actions.loadIntermediates(props.sessionId, tid);
      } else {
        actions.evictIntermediates(props.sessionId, tid);
      }
    }
  };

  // Re-measure the virtual list when this turn's message count changes
  // (intermediates loaded on expand / evicted on collapse).
  createEffect(
    on(
      () => turn().messages.length,
      () => props.onHeightChanged?.(),
    ),
  );

  const durationLabel = createMemo(() => {
    const { startedAt, endedAt } = turn();
    if (startedAt === null) {
      return null;
    }
    if (endedAt !== null) {
      return formatDuration(endedAt - startedAt);
    }
    return formatDuration(liveMs());
  });

  const thinkingParts = createMemo(() => getThinkingParts(turn().messages));

  const canCollapse = createMemo(() => {
    const t = turn();
    if (t.endedAt === null || t.error) {
      return false;
    }
    return t.messages.length > 1 || t.intermediateCount > 0 || thinkingParts().length > 0;
  });

  createEffect(
    on(
      () => [expanded(), canCollapse()] as const,
      (cur, prev) => {
        log.debug("header state", {
          expanded: cur[0],
          canCollapse: cur[1],
          prevExpanded: prev?.[0],
          prevCanCollapse: prev?.[1],
          endedAt: turn().endedAt,
          turnId: turn().turnId,
          msgCount: turn().messages.length,
          intermediateCount: turn().intermediateCount,
        });
      },
    ),
  );

  const intermediateMessages = createMemo(() => {
    const msgs = turn().messages;
    if (msgs.length <= 1) {
      return [];
    }
    return msgs.slice(0, -1);
  });

  const summaryMessage = createMemo(() => {
    const msgs = turn().messages;
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

      <Show when={durationLabel() && (turn().endedAt === null || canCollapse())}>
        <button
          class="flex w-full items-center gap-2 border-border/50 border-b px-3 py-1.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted/30 disabled:cursor-default disabled:hover:bg-transparent"
          data-slot="turn-header"
          disabled={!canCollapse()}
          onClick={handleToggle}
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
      <Show when={!canCollapse() && turn().messages.length > 0}>
        <div
          class="flex flex-col gap-3 px-3 [overflow-anchor:none]"
          data-slot="session-turn-stream"
        >
          <For each={thinkingParts()}>{(part) => <ThinkingBlock part={part} />}</For>
          <Show when={turn().error && !turn().working}>
            <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">
              {turn().error}
            </div>
          </Show>
          <For each={turn().messages}>{(msg) => MessageContent(msg)}</For>
        </div>
      </Show>

      {/* Collapsible: accordion thinking + intermediate + always-visible summary */}
      <Show when={canCollapse()}>
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-in-out"
          style={{
            "grid-template-rows": expanded() ? "1fr" : "0fr",
          }}
        >
          <div class="min-h-0 overflow-hidden">
            <div class="flex flex-col gap-3 px-3 py-2 opacity-50 [overflow-anchor:none]">
              <For each={thinkingParts()}>{(part) => <ThinkingBlock part={part} />}</For>
              <For each={intermediateMessages()}>{(msg) => MessageContent(msg)}</For>
            </div>
          </div>
        </div>

        <Show when={summaryMessage()}>
          {(msg) => (
            <div
              class="flex flex-col gap-3 px-3 [overflow-anchor:none]"
              data-slot="session-turn-stream"
            >
              {MessageContent(msg())}
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
