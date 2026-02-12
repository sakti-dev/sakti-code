import { cn } from "@/utils";
import { createSignal, JSX, mergeProps, onCleanup, onMount, Show } from "solid-js";

interface ResizablePanelProps {
  /** Default width in pixels */
  defaultSize?: number;
  /** Minimum width in pixels */
  minSize?: number;
  /** Maximum width in pixels */
  maxSize?: number;
  /** Panel position for resize handle placement */
  position: "left" | "right";
  /** Whether panel can be collapsed */
  collapsible?: boolean;
  /** Current collapsed state */
  isCollapsed?: boolean;
  /** Callback when size changes */
  onSizeChange?: (size: number) => void;
  /** Callback when collapse state changes */
  onCollapseChange?: (collapsed: boolean) => void;
  /** Panel content */
  children: JSX.Element;
  /** Additional CSS classes */
  class?: string;
}

/**
 * ResizablePanel - A resizable panel component with collapse support
 *
 * Features:
 * - Drag-to-resize with visual feedback
 * - Smooth 200ms resize transitions
 * - Collapse/expand with animation
 * - Min/max size constraints
 * - Glow effect on resize handle hover
 */
export function ResizablePanel(props: ResizablePanelProps) {
  const merged = mergeProps(
    {
      defaultSize: 280,
      minSize: 200,
      maxSize: 600,
      collapsible: true,
      isCollapsed: false,
    },
    props
  );

  const [isResizing, setIsResizing] = createSignal(false);
  const [isCollapsed, setIsCollapsed] = createSignal(merged.isCollapsed);
  const [panelSize, setPanelSize] = createSignal(merged.defaultSize);

  let panelRef: HTMLDivElement | undefined;
  let startX = 0;
  let startWidth = 0;

  const handleMouseDown = (e: MouseEvent) => {
    if (!panelRef) return;
    setIsResizing(true);
    startX = e.clientX;
    startWidth = panelRef.offsetWidth;
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isResizing() || !panelRef) return;

    const deltaX = merged.position === "left" ? e.clientX - startX : startX - e.clientX;
    const newWidth = Math.max(merged.minSize, Math.min(merged.maxSize, startWidth + deltaX));

    setPanelSize(newWidth);
    merged.onSizeChange?.(newWidth);
  };

  const handleMouseUp = () => {
    if (isResizing()) {
      setIsResizing(false);
    }
  };

  const toggleCollapse = () => {
    if (!merged.collapsible) return;
    const newState = !isCollapsed();
    setIsCollapsed(newState);
    merged.onCollapseChange?.(newState);
  };

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  });

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  });

  const panelStyle = () => ({
    width: isCollapsed() ? "0px" : `${panelSize()}px`,
    "min-width": isCollapsed() ? "0px" : `${merged.minSize}px`,
    "max-width": isCollapsed() ? "0px" : `${merged.maxSize}px`,
  });

  return (
    <div
      ref={panelRef}
      class={cn("resize-smooth relative flex shrink-0 overflow-hidden", merged.class)}
      style={panelStyle()}
    >
      {/* Panel content */}
      <div class={cn("flex-1 overflow-hidden", isCollapsed() && "pointer-events-none opacity-0")}>
        {merged.children}
      </div>

      {/* Resize handle */}
      <Show when={!isCollapsed()}>
        <div
          class={cn(
            "resize-handle absolute bottom-0 top-0 w-1 cursor-col-resize transition-colors duration-150",
            merged.position === "left" ? "-right-0.5" : "-left-0.5",
            isResizing() && "bg-primary/50"
          )}
          onMouseDown={handleMouseDown}
        />
      </Show>

      {/* Collapse button */}
      <Show when={merged.collapsible}>
        <button
          onClick={toggleCollapse}
          class={cn(
            "absolute top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5",
            "bg-card/80 border-border/40 border",
            "hover:bg-card hover:border-primary/30",
            "transition-all duration-200",
            "opacity-0 hover:opacity-100 group-hover:opacity-100",
            merged.position === "left"
              ? isCollapsed()
                ? "-right-8"
                : "-right-4"
              : isCollapsed()
                ? "-left-8"
                : "-left-4"
          )}
          aria-label={isCollapsed() ? "Expand panel" : "Collapse panel"}
        >
          <svg
            class="text-foreground/60 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {merged.position === "left" ? (
              isCollapsed() ? (
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M9 5l7 7-7 7"
                />
              ) : (
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width={2}
                  d="M15 19l-7-7 7-7"
                />
              )
            ) : isCollapsed() ? (
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M15 19l-7-7 7-7"
              />
            ) : (
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width={2}
                d="M9 5l7 7-7 7"
              />
            )}
          </svg>
        </button>
      </Show>
    </div>
  );
}
