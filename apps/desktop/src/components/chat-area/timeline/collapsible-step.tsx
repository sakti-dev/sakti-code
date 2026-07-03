import { TbOutlineChevronRight } from "solid-icons/tb";
import { type Component, type JSX, Show } from "solid-js";

export interface CollapsibleStepProps {
  children: JSX.Element;
  expanded: boolean;
  label: JSX.Element;
  onToggle: () => void;
}

/**
 * A collapsible step body: a clickable header (label + rotating chevron) and a
 * grid-animated (0fr ↔ 1fr) content region. Shared by ThinkingStep and
 * ExploreStep so both share the same look-and-feel and auto-collapse behavior.
 */
export const CollapsibleStep: Component<CollapsibleStepProps> = (props) => {
  return (
    <div data-component="collapsible-step">
      <button
        class="flex cursor-pointer items-center gap-1 pb-1 text-left text-muted-foreground"
        data-slot="collapsible-trigger"
        onClick={props.onToggle}
        type="button"
      >
        <span class="flex-1">{props.label}</span>
        <TbOutlineChevronRight
          class="h-3 w-3 shrink-0 transition-transform duration-200"
          classList={{ "rotate-90": props.expanded, "rotate-0": !props.expanded }}
          data-slot="collapsible-chevron"
        />
      </button>
      <div
        class="grid transition-[grid-template-rows] duration-200 ease-in-out"
        data-slot="collapsible-content"
        style={{ "grid-template-rows": props.expanded ? "1fr" : "0fr" }}
      >
        <div class="min-h-0 overflow-hidden">
          <Show when={props.expanded}>{props.children}</Show>
        </div>
      </div>
    </div>
  );
};
