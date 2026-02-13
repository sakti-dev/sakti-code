/**
 * BasicTool Component
 *
 * A collapsible tool card with status indicators for displaying tool execution.
 * Used as the base for all tool part renderers.
 */

import { Collapsible } from "@/components/shared/collapsible";
import { Icon } from "@/components/shared/icon";
import { cn } from "@/utils";
import { createSignal, Show, type JSX, type ParentComponent } from "solid-js";

export interface TriggerTitle {
  title: string;
  subtitle?: string;
  args?: string;
}

export interface BasicToolProps {
  /** Icon name to display */
  icon?: string;
  /** Trigger content */
  trigger: TriggerTitle;
  /** Content to show when expanded */
  children?: JSX.Element;
  /** Hide the expand/collapse arrow */
  hideDetails?: boolean;
  /** Start expanded */
  defaultOpen?: boolean;
  /** Force content to stay expanded */
  forceOpen?: boolean;
  /** Prevent collapse when open */
  locked?: boolean;
  /** Tool execution status */
  status?: "running" | "completed" | "error" | "pending";
  /** Additional CSS classes */
  class?: string;
}

/**
 * BasicTool - Collapsible tool card with status indicators
 *
 * @example
 * ```tsx
 * <BasicTool
 *   trigger={{ title: "Read File", subtitle: "src/index.ts" }}
 *   icon="file"
 *   status="completed"
 * >
 *   <pre>file contents</pre>
 * </BasicTool>
 * ```
 */
export const BasicTool: ParentComponent<BasicToolProps> = props => {
  const [internalOpen, setInternalOpen] = createSignal(props.defaultOpen ?? false);

  const isOpen = () => props.forceOpen ?? internalOpen();

  const handleOpenChange = (open: boolean) => {
    if (props.forceOpen || props.locked) {
      return; // Prevent closing
    }
    setInternalOpen(open);
  };

  const hasChildren = () => Boolean(props.children);

  const renderTrigger = () => {
    const triggerTitle = props.trigger;
    return (
      <>
        <Show when={props.icon}>
          <Icon name={props.icon as "file" | "folder" | "terminal"} class="h-4 w-4 shrink-0" />
        </Show>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="truncate text-sm font-medium">{triggerTitle.title}</span>
          <Show when={triggerTitle.subtitle || triggerTitle.args}>
            <span class="text-muted-foreground truncate text-xs">
              {triggerTitle.subtitle}
              {triggerTitle.args ? (triggerTitle.subtitle ? " · " : "") + triggerTitle.args : ""}
            </span>
          </Show>
        </div>
      </>
    );
  };

  return (
    <Collapsible
      data-component="basic-tool"
      data-status={props.status ?? "pending"}
      open={isOpen()}
      onOpenChange={handleOpenChange}
      class={cn(
        "border-border/40 bg-card/50 min-w-0 rounded-lg border",
        "data-[status=error]:border-destructive/40 data-[status=error]:bg-destructive/10",
        props.class
      )}
    >
      <Collapsible.Trigger
        data-slot="basic-tool-trigger"
        aria-expanded={isOpen()}
        onKeyDown={event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          handleOpenChange(!isOpen());
        }}
        class={cn(
          "flex w-full min-w-0 items-center gap-2 p-3 text-left",
          "hover:bg-muted/50 transition-colors",
          "focus:ring-primary/30 focus:outline-none focus:ring-2"
        )}
      >
        <Show when={props.status === "running"}>
          <div
            data-slot="basic-tool-status-icon"
            class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        </Show>
        {renderTrigger()}
        <Show when={hasChildren() && !props.hideDetails}>
          <div data-slot="basic-tool-arrow" class="ml-auto shrink-0">
            <Collapsible.Arrow />
          </div>
        </Show>
      </Collapsible.Trigger>

      <Show when={hasChildren()}>
        <Collapsible.Content
          data-slot="basic-tool-content"
          class="data-[expanded]:animate-collapsible-down data-[closed]:animate-collapsible-up overflow-hidden"
        >
          <div class="border-border/40 border-t p-3 pt-2">{props.children}</div>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  );
};
