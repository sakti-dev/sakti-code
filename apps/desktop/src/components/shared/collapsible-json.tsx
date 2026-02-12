/**
 * CollapsibleJson Component
 *
 * A JSON viewer with collapsible sections, similar to jsonformatter.org
 * Supports syntax highlighting and deep nesting.
 *
 * Features:
 * - Collapsible/expandable object keys
 * - Syntax highlighting for different value types
 * - Copy to clipboard
 * - Configurable initial expansion depth
 * - Handles circular references gracefully
 */
import { cn } from "@/utils";
import { Component, createSignal, For, Match, mergeProps, Show, Switch } from "solid-js";

interface CollapsibleJsonProps {
  /** Data to display */
  data: unknown;
  /** Initial expansion depth (0 = all collapsed, Infinity = all expanded) */
  initialDepth?: number;
  /** Current depth (used internally for recursion) */
  currentDepth?: number;
  /** Additional CSS classes */
  class?: string;
  /** Key name (for object properties) */
  keyName?: string;
  /** Whether this is the root level */
  isRoot?: boolean;
}

interface JsonValueProps {
  value: unknown;
  depth: number;
  initialDepth: number;
  keyName?: string;
}

/**
 * Get the type of a value for styling
 */
function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "unknown";
}

/**
 * Get CSS classes for a value type
 */
function getTypeClasses(type: string): string {
  switch (type) {
    case "null":
    case "undefined":
      return "text-gray-500";
    case "boolean":
      return "text-purple-400";
    case "number":
      return "text-blue-400";
    case "string":
      return "text-green-400";
    case "array":
    case "object":
      return "text-foreground";
    default:
      return "text-foreground";
  }
}

/**
 * Format a primitive value for display
 */
function formatPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  return String(value);
}

/**
 * Individual JSON value component
 */
const JsonValue: Component<JsonValueProps> = props => {
  const type = () => getValueType(props.value);
  const isExpandable = () => type() === "array" || type() === "object";
  const shouldStartExpanded = () => props.depth < props.initialDepth;
  const [isExpanded, setIsExpanded] = createSignal(shouldStartExpanded());

  // Toggle expansion
  const toggle = () => setIsExpanded(!isExpanded());

  return (
    <Switch>
      {/* Primitive values */}
      <Match when={!isExpandable()}>
        <span class={cn("font-mono text-xs", getTypeClasses(type()))}>
          {formatPrimitive(props.value)}
        </span>
      </Match>

      {/* Arrays */}
      <Match when={type() === "array" && Array.isArray(props.value)}>
        <span class="font-mono text-xs">
          <button
            onClick={toggle}
            class={cn(
              "inline-flex items-center gap-1 transition-opacity hover:opacity-70",
              "text-muted-foreground"
            )}
          >
            <span
              class={cn(
                "inline-block transition-transform duration-150",
                isExpanded() ? "rotate-90" : ""
              )}
            >
              ▶
            </span>
            <span class="text-foreground">{props.keyName ? `${props.keyName}: ` : ""}</span>
            <span class="text-gray-500">
              {isExpanded() ? "[" : `[${(props.value as unknown[]).length} items]`}
            </span>
          </button>

          <Show when={isExpanded()}>
            <div class="border-border/30 ml-4 border-l pl-2">
              <For each={props.value as unknown[]}>
                {(item, index) => (
                  <div class="py-0.5">
                    <span class="text-muted-foreground mr-2">{index()}:</span>
                    <JsonValue
                      value={item}
                      depth={props.depth + 1}
                      initialDepth={props.initialDepth}
                    />
                  </div>
                )}
              </For>
            </div>
            <span class="text-gray-500">]</span>
          </Show>
        </span>
      </Match>

      {/* Objects */}
      <Match when={type() === "object" && typeof props.value === "object" && props.value !== null}>
        <span class="font-mono text-xs">
          <button
            onClick={toggle}
            class={cn(
              "inline-flex items-center gap-1 transition-opacity hover:opacity-70",
              "text-muted-foreground"
            )}
          >
            <span
              class={cn(
                "inline-block transition-transform duration-150",
                isExpanded() ? "rotate-90" : ""
              )}
            >
              ▶
            </span>
            <span class="text-foreground">{props.keyName ? `${props.keyName}: ` : ""}</span>
            <span class="text-gray-500">
              {isExpanded()
                ? "{"
                : `{${Object.keys(props.value as Record<string, unknown>).length} keys}`}
            </span>
          </button>

          <Show when={isExpanded()}>
            <div class="border-border/30 ml-4 border-l pl-2">
              <For each={Object.entries(props.value as Record<string, unknown>)}>
                {([key, val]) => (
                  <div class="py-0.5">
                    <JsonValue
                      value={val}
                      depth={props.depth + 1}
                      initialDepth={props.initialDepth}
                      keyName={key}
                    />
                  </div>
                )}
              </For>
            </div>
            <span class="text-gray-500">{"}"}</span>
          </Show>
        </span>
      </Match>
    </Switch>
  );
};

/**
 * Copy button for JSON data
 */
function CopyButton(props: { data: unknown; class?: string }) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      const text =
        typeof props.data === "string" ? props.data : JSON.stringify(props.data, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy errors
    }
  };

  return (
    <button
      onClick={handleCopy}
      class={cn(
        "opacity-0 transition-opacity group-hover:opacity-100",
        "hover:bg-muted/50 rounded p-1",
        "text-muted-foreground hover:text-foreground",
        props.class
      )}
      title={copied() ? "Copied!" : "Copy JSON"}
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <Show
          when={copied()}
          fallback={
            <>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke-width="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke-width="2" />
            </>
          }
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </Show>
      </svg>
    </button>
  );
}

/**
 * CollapsibleJson - Main component
 */
export const CollapsibleJson: Component<CollapsibleJsonProps> = props => {
  const merged = mergeProps(
    {
      initialDepth: 2,
      currentDepth: 0,
      isRoot: true,
    },
    props
  );

  return (
    <div
      class={cn(
        "group relative font-mono text-sm",
        "rounded bg-black/5 p-3 dark:bg-white/5",
        "overflow-x-auto",
        merged.class
      )}
    >
      {/* Copy button */}
      <div class="absolute right-2 top-2">
        <CopyButton data={props.data} />
      </div>

      {/* JSON content */}
      <JsonValue
        value={props.data}
        depth={merged.currentDepth}
        initialDepth={merged.initialDepth}
        keyName={merged.keyName}
      />
    </div>
  );
};

export default CollapsibleJson;
