import { FiCheck, FiCopy } from "solid-icons/fi";
import {
  type Component,
  createSignal,
  For,
  Match,
  mergeProps,
  Show,
  Switch,
} from "solid-js";
import { cn } from "~/lib/utils";

interface CollapsibleJsonProps {
  class?: string;
  currentDepth?: number;
  data: unknown;
  initialDepth?: number;
  isRoot?: boolean;
  keyName?: string;
}

interface JsonValueProps {
  depth: number;
  initialDepth: number;
  keyName?: string;
  value: unknown;
}

function getValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return "string";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  return "unknown";
}

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

function formatPrimitive(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
}

const JsonValue: Component<JsonValueProps> = (props) => {
  const type = () => getValueType(props.value);
  const isExpandable = () => type() === "array" || type() === "object";
  const shouldStartExpanded = () => props.depth < props.initialDepth;
  const [isExpanded, setIsExpanded] = createSignal(shouldStartExpanded());

  const toggle = () => setIsExpanded(!isExpanded());

  return (
    <Switch>
      <Match when={!isExpandable()}>
        <span class={cn("font-mono text-xs", getTypeClasses(type()))}>
          {formatPrimitive(props.value)}
        </span>
      </Match>

      <Match when={type() === "array" && Array.isArray(props.value)}>
        <span class="font-mono text-xs">
          <button
            class={cn(
              "inline-flex items-center gap-1 transition-opacity hover:opacity-70",
              "text-muted-foreground"
            )}
            onClick={toggle}
            type="button"
          >
            <span
              class={cn(
                "inline-block transition-transform duration-150",
                isExpanded() ? "rotate-90" : ""
              )}
            >
              ▶
            </span>
            <span class="text-foreground">
              {props.keyName ? `${props.keyName}: ` : ""}
            </span>
            <span class="text-gray-500">
              {isExpanded()
                ? "["
                : `[${(props.value as unknown[]).length} items]`}
            </span>
          </button>

          <Show when={isExpanded()}>
            <div class="ml-4 border-border/30 border-l pl-2">
              <For each={props.value as unknown[]}>
                {(item, index) => (
                  <div class="py-0.5">
                    <span class="mr-2 text-muted-foreground">{index()}:</span>
                    <JsonValue
                      depth={props.depth + 1}
                      initialDepth={props.initialDepth}
                      value={item}
                    />
                  </div>
                )}
              </For>
            </div>
            <span class="text-gray-500">]</span>
          </Show>
        </span>
      </Match>

      <Match
        when={
          type() === "object" &&
          typeof props.value === "object" &&
          props.value !== null
        }
      >
        <span class="font-mono text-xs">
          <button
            class={cn(
              "inline-flex items-center gap-1 transition-opacity hover:opacity-70",
              "text-muted-foreground"
            )}
            onClick={toggle}
            type="button"
          >
            <span
              class={cn(
                "inline-block transition-transform duration-150",
                isExpanded() ? "rotate-90" : ""
              )}
            >
              ▶
            </span>
            <span class="text-foreground">
              {props.keyName ? `${props.keyName}: ` : ""}
            </span>
            <span class="text-gray-500">
              {isExpanded()
                ? "{"
                : `{${Object.keys(props.value as Record<string, unknown>).length} keys}`}
            </span>
          </button>

          <Show when={isExpanded()}>
            <div class="ml-4 border-border/30 border-l pl-2">
              <For
                each={Object.entries(props.value as Record<string, unknown>)}
              >
                {([key, val]) => (
                  <div class="py-0.5">
                    <JsonValue
                      depth={props.depth + 1}
                      initialDepth={props.initialDepth}
                      keyName={key}
                      value={val}
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

function CopyButton(props: { data: unknown; class?: string }) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      const text =
        typeof props.data === "string"
          ? props.data
          : JSON.stringify(props.data, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore copy errors
    }
  };

  return (
    <button
      class={cn(
        "opacity-0 transition-opacity group-hover:opacity-100",
        "rounded p-1 hover:bg-muted/50",
        "text-muted-foreground hover:text-foreground",
        props.class
      )}
      onClick={handleCopy}
      title={copied() ? "Copied!" : "Copy JSON"}
      type="button"
    >
      <Show fallback={<FiCopy class="h-3.5 w-3.5" />} when={copied()}>
        <FiCheck class="h-3.5 w-3.5" />
      </Show>
    </button>
  );
}

export const CollapsibleJson: Component<CollapsibleJsonProps> = (props) => {
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
      <div class="absolute top-2 right-2">
        <CopyButton data={props.data} />
      </div>

      <JsonValue
        depth={merged.currentDepth}
        initialDepth={merged.initialDepth}
        keyName={merged.keyName}
        value={props.data}
      />
    </div>
  );
};

export default CollapsibleJson;
