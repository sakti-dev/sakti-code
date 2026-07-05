import { FiCheckCircle, FiClipboard, FiFileText } from "solid-icons/fi";
import { createSignal, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";

export type AskKind = "session" | "spec" | "completion";

const COPY: Record<
  AskKind,
  { title: string; approve: string; reject: string; icon: typeof FiClipboard }
> = {
  session: { title: "Proposed Session", approve: "Create", reject: "Revise", icon: FiClipboard },
  spec: { title: "Proposed Spec", approve: "Approve", reject: "Revise", icon: FiFileText },
  completion: {
    title: "Ready for Review",
    approve: "Merge",
    reject: "Request changes",
    icon: FiCheckCircle,
  },
};

interface AskCardProps {
  kind: AskKind;
  body: string;
  onApprove: () => void;
  onReject: () => void;
}

export function AskCard(props: AskCardProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(true);
  const copy = () => COPY[props.kind];

  return (
    <div
      class="rounded-lg border border-primary/30 bg-primary/5 p-4"
      data-component="ask-card"
      data-kind={props.kind}
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
          class="rounded-lg bg-primary px-4 py-1.5 text-primary-foreground text-sm hover:bg-primary/90"
          data-action="approve"
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
