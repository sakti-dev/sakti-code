import { cn } from "@/utils";
import {
  ActionButtonPart,
  type ActionButton,
} from "@/views/workspace-view/chat-area/parts/action-button-part";
import { Show, type Component } from "solid-js";

export interface ResearchOutputProps {
  loading?: boolean;
  summary?: string;
  buttons?: ActionButton[];
  onAction?: (action: string, button: ActionButton) => void;
  class?: string;
}

export const ResearchOutput: Component<ResearchOutputProps> = props => {
  return (
    <section class={cn("rounded-xl border border-border/40 bg-card/20 p-4", props.class)}>
      <Show when={props.loading} fallback={<SummaryBlock summary={props.summary} />}>
        <p class="text-muted-foreground text-sm">Researching your request...</p>
      </Show>

      <Show when={!props.loading && (props.buttons?.length ?? 0) > 0}>
        <div class="mt-3 border-t border-border/30 pt-3">
          <ActionButtonPart
            part={{ type: "action_buttons", buttons: props.buttons ?? [] }}
            onAction={(action, button) => props.onAction?.(action, button)}
          />
        </div>
      </Show>
    </section>
  );
};

const SummaryBlock: Component<{ summary?: string }> = props => (
  <Show
    when={props.summary && props.summary.trim().length > 0}
    fallback={<p class="text-muted-foreground text-sm">No research output yet.</p>}
  >
    <p class="text-foreground text-sm leading-6">{props.summary}</p>
  </Show>
);

export default ResearchOutput;
