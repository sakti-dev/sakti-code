import { TbOutlineBrain } from "solid-icons/tb";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { formatDuration } from "~/lib/format-duration";
import { Markdown } from "~/components/ui/markdown";
import type { PartProps } from "./part-registry.ts";

export const ThinkingPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "thinking" ? props.part.text : "");

  const isEmpty = () => {
    const t = text();
    return !t || t.trim() === "";
  };

  const isThinkingActive = createMemo(() => {
    if (props.part.type !== "thinking") {
      return false;
    }
    // Only live-streamed parts have startedAt; hydrated parts never do.
    // This prevents hydrated parts from being treated as "active" when
    // an unrelated turn starts streaming (isStreaming is global).
    return (
      props.part.startedAt !== undefined &&
      props.part.endedAt === undefined &&
      props.isStreaming === true
    );
  });

  const headerLabel = createMemo(() => {
    if (isThinkingActive()) {
      return "Thinking...";
    }
    if (props.part.type !== "thinking") {
      return "Thought";
    }
    const { startedAt, endedAt } = props.part;
    if (startedAt !== undefined && endedAt !== undefined) {
      return `Thought for ${formatDuration(endedAt - startedAt)}`;
    }
    return "Thought";
  });

  const [expanded, setExpanded] = createSignal(false);
  const [contentEl, setContentEl] = createSignal<HTMLDivElement | null>(null);

  let userAtBottom = true;

  const handleContentScroll = () => {
    const el = contentEl();
    if (!el) {
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    userAtBottom = distance < 50;
  };

  createEffect(
    on(isThinkingActive, (active, prev) => {
      if (active) {
        setExpanded(true);
      } else if (prev === true) {
        // Defer to next frame so the browser commits the current (expanded)
        // state before transitioning to collapsed — without this, the style
        // change coalesces with other batch updates and the transition is skipped.
        requestAnimationFrame(() => setExpanded(false));
      }
    }),
  );

  // Internal auto-scroll: follow new tokens within the max-h-[200px] container.
  // RAF ensures the Markdown DOM update has flushed before measuring scrollHeight.
  createEffect(() => {
    text();
    if (!isThinkingActive()) {
      return;
    }
    requestAnimationFrame(() => {
      const el = contentEl();
      if (el && userAtBottom) {
        el.scrollTop = el.scrollHeight;
      }
    });
  });

  const toggle = () => setExpanded((e) => !e);

  onCleanup(() => setContentEl(null));

  return (
    <Show when={!isEmpty()}>
      <div class="rounded-lg bg-muted/30 text-muted-foreground" data-component="thinking-part">
        <button
          class="flex w-full cursor-pointer items-center gap-2 py-2 pr-3 pl-4 text-left font-medium text-sm"
          data-slot="thinking-header"
          onClick={toggle}
          type="button"
        >
          <TbOutlineBrain
            class="h-4 w-4 shrink-0"
            classList={{ "animate-pulse": isThinkingActive() }}
          />
          <span
            classList={{
              "animate-shimmer text-shimmer": isThinkingActive(),
            }}
          >
            {headerLabel()}
          </span>
        </button>
        <div
          class="grid transition-[grid-template-rows] duration-200 ease-in-out"
          data-slot="thinking-content"
          style={{ "grid-template-rows": expanded() ? "1fr" : "0fr" }}
        >
          <div class="min-h-0 overflow-hidden">
            <div
              class="max-h-[200px] overflow-y-auto border-border/50 border-t px-4 py-2.5 italic leading-relaxed"
              onScroll={handleContentScroll}
              ref={setContentEl}
              style={{ "--foreground": "var(--muted-foreground)" }}
            >
              <Markdown class="prose-p:m-0 text-sm" isStreaming={props.isStreaming} text={text()} />
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
