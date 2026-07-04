import { FiArchive } from "solid-icons/fi";
import { TbOutlineChevronRight } from "solid-icons/tb";
import { createSignal, For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { MissionRow, type MissionStatus, type StreamPhase } from "./mission-row";

export interface ArchivedMission {
  id: string;
  title: string | null;
  updatedAt: number;
  streamPhase: StreamPhase;
}

export interface ArchivedAccordionProps {
  missions: ArchivedMission[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
}

export function ArchivedAccordion(props: ArchivedAccordionProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const count = () => props.missions.length;

  return (
    <div class="border-border border-t" data-component="archived-accordion">
      <button
        class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <TbOutlineChevronRight
          class={cn("h-3 w-3 transition-transform", expanded() && "rotate-90")}
        />
        <FiArchive class="h-3.5 w-3.5" />
        <span class="flex-1 font-medium">Archived</span>
        <Show when={count() > 0}>
          <span class="tabular-nums text-muted-foreground/70">{count()}</span>
        </Show>
      </button>
      <Show when={expanded()}>
        <For each={props.missions}>
          {(m) => (
            <MissionRow
              isActive={props.activeId === m.id}
              status={"merged" as MissionStatus}
              streamPhase={m.streamPhase}
              title={m.title}
              updatedAt={m.updatedAt}
              onClick={() => props.onSelect(m.id)}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
