import { TbOutlineArrowsMinimize } from "solid-icons/tb";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { Markdown } from "~/components/ui/markdown";
import type { PartProps } from "./part-registry.ts";

export const CompactionPart: Component<PartProps> = (props) => {
  const text = () => (props.part.type === "compaction" ? props.part.text : "");
  const status = () => (props.part.type === "compaction" ? props.part.status : "complete");
  const tokensBefore = () =>
    props.part.type === "compaction" ? props.part.tokensBefore : undefined;
  const error = () => (props.part.type === "compaction" ? props.part.error : undefined);

  const isActive = createMemo(() => status() === "loading");

  const headerLabel = createMemo(() => {
    if (isActive()) {
      return "Compressing...";
    }
    if (status() === "failed") {
      return "Compression failed";
    }
    const t = tokensBefore();
    return t !== undefined
      ? `Context compressed (${t.toLocaleString()} tokens)`
      : "Context compressed";
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
    on(isActive, (active, prev) => {
      if (active) {
        setExpanded(true);
      } else if (prev === true) {
        requestAnimationFrame(() => setExpanded(false));
      }
    }),
  );

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

  const toggle = () => setExpanded((e) => !e);

  onCleanup(() => setContentEl(null));

  return (
    <div class="rounded-lg bg-muted/30 text-muted-foreground" data-component="compaction-part">
      <button
        class="flex w-full cursor-pointer items-center gap-2 py-2 pr-3 pl-4 text-left font-medium text-sm"
        data-slot="compaction-header"
        onClick={toggle}
        type="button"
      >
        <TbOutlineArrowsMinimize
          class="h-4 w-4 shrink-0"
          classList={{ "animate-pulse": isActive() }}
        />
        <span
          classList={{
            "animate-shimmer text-shimmer": isActive(),
          }}
        >
          {headerLabel()}
        </span>
      </button>
      <Show when={status() === "failed" && error()}>
        <div class="px-4 pb-2 text-destructive text-sm">{error()}</div>
      </Show>
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-in-out"
        data-slot="compaction-content"
        style={{ "grid-template-rows": expanded() ? "1fr" : "0fr" }}
      >
        <div class="min-h-0 overflow-hidden">
          <Show when={text().trim().length > 0}>
            <div
              class="max-h-[200px] overflow-y-auto border-border/50 border-t px-4 py-2.5 italic leading-relaxed"
              onScroll={handleContentScroll}
              ref={setContentEl}
              style={{ "--foreground": "var(--muted-foreground)" }}
            >
              <Markdown class="prose-p:m-0 text-sm" isStreaming={isActive()} text={text()} />
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
