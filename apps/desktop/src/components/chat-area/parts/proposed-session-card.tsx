import { createSignal, type JSX, Show } from "solid-js";

interface ProposedSessionCardProps {
  onConfirm: () => void;
  onReject: () => void;
  proposal: { message: string; title: string };
}

export function ProposedSessionCard(props: ProposedSessionCardProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div
      class="rounded-lg border border-primary/30 bg-primary/5 p-4"
      data-component="proposed-session-card"
    >
      <div class="mb-2 flex items-center gap-2">
        <span class="text-lg">{"\u{1F4CB}"}</span>
        <span class="font-semibold text-sm">Proposed Session</span>
      </div>
      <h3 class="mb-2 font-medium text-foreground">{props.proposal.title}</h3>
      <Show
        fallback={
          <button
            class="text-primary text-xs hover:underline"
            onClick={() => setExpanded(true)}
            type="button"
          >
            Show brief →
          </button>
        }
        when={expanded()}
      >
        <pre class="mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-muted-foreground text-xs">
          {props.proposal.message}
        </pre>
      </Show>
      <div class="flex gap-2">
        <button
          class="rounded-lg bg-primary px-4 py-1.5 text-primary-foreground text-sm hover:bg-primary/90"
          data-action="confirm-session"
          onClick={() => props.onConfirm()}
          type="button"
        >
          Create Session
        </button>
        <button
          class="rounded-lg border border-border px-4 py-1.5 text-muted-foreground text-sm hover:bg-muted"
          data-action="reject-session"
          onClick={() => props.onReject()}
          type="button"
        >
          Revise
        </button>
      </div>
    </div>
  );
}
