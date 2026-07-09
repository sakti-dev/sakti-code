import { FiArchive, FiCheckCircle, FiClipboard, FiFileText } from "solid-icons/fi";
import { createSignal, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

/** Destination phases that render a gate card. Auto edges never reach the card. */
export type TransitionGateTo = "archive" | "build" | "done" | "mission";

const COPY: Record<
  TransitionGateTo,
  { title: string; approve: string; reject: string; icon: typeof FiClipboard }
> = {
  mission: { title: "Proposed Mission", approve: "Create", reject: "Revise", icon: FiClipboard },
  build: { title: "Proposed Spec", approve: "Approve", reject: "Revise", icon: FiFileText },
  archive: {
    title: "Ready to Archive",
    approve: "Archive",
    reject: "Request changes",
    icon: FiArchive,
  },
  done: {
    title: "Archive Complete",
    approve: "Finish & Remove Worktree",
    reject: "Keep",
    icon: FiCheckCircle,
  },
};

interface TransitionCardProps {
  to: string;
  body: string;
  onApprove: () => void;
  onReject: () => void;
  approveDisabled?: boolean;
}

export function TransitionCard(props: TransitionCardProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(true);
  const copy = () => COPY[props.to as TransitionGateTo] ?? COPY.build;

  return (
    <div
      class="rounded-lg border border-primary/30 bg-primary/5 p-4"
      data-component="transition-card"
      data-to={props.to}
    >
      <div class="mb-2 flex items-center gap-2">
        <Dynamic component={copy().icon} class="h-4 w-4 text-primary" />
        <span class="font-semibold text-sm">{copy().title}</span>
      </div>
      <Show when={expanded()}>
        <pre class="mb-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-muted-foreground text-xs">
          {props.body}
        </pre>
      </Show>
      <button
        class="mb-2 text-muted-foreground text-xs hover:underline"
        onClick={() => setExpanded((e) => !e)}
        type="button"
      >
        {expanded() ? "Hide" : "Show"}
      </button>
      <div class="flex gap-2">
        <button
          class="rounded-lg bg-primary px-4 py-1.5 text-primary-foreground text-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          data-action="approve"
          disabled={props.approveDisabled}
          onClick={() => props.onApprove()}
          type="button"
        >
          {copy().approve}
        </button>
        <button
          class="rounded-lg border border-border px-4 py-1.5 text-muted-foreground text-sm hover:bg-muted"
          data-action="reject"
          onClick={() => props.onReject()}
          type="button"
        >
          {copy().reject}
        </button>
      </div>
    </div>
  );
}
