import { CollapsibleJson } from "@/components/shared/collapsible-json";
import type { StreamEvent, UseStreamDebuggerResult } from "@/core/chat/hooks/use-stream-debugger";
import { cn } from "@/utils";
import { Component, createMemo, createSignal, For, Show } from "solid-js";

interface StreamDebuggerPanelProps {
  debugger: UseStreamDebuggerResult;
  onClose: () => void;
  class?: string;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

function summarizeEvent(event: StreamEvent): string {
  if (event.type === "text-delta") {
    const delta = (event.payload as { delta?: unknown }).delta;
    if (typeof delta === "string") {
      const trimmed = delta.replace(/\s+/g, " ").trim();
      return trimmed.length > 80 ? `${trimmed.slice(0, 80)}...` : trimmed;
    }
    return "text";
  }

  if (event.type === "tool-call-start") {
    const toolName = (event.payload as { data?: { toolName?: unknown } }).data?.toolName;
    return typeof toolName === "string" ? toolName : "tool call";
  }

  if (event.type === "tool-result") {
    return "tool result";
  }

  if (event.type === "complete") {
    const reason = (event.payload as { finishReason?: unknown }).finishReason;
    return typeof reason === "string" ? `finish: ${reason}` : "finish";
  }

  if (event.type === "error") {
    const text = (event.payload as { errorText?: unknown }).errorText;
    return typeof text === "string" ? text : "error";
  }

  if (event.type === "data-part") {
    const partType = (event.payload as { type?: unknown }).type;
    return typeof partType === "string" ? partType : "data part";
  }

  if (event.type === "raw") return "raw line";
  return event.type;
}

function compactMessages(snapshot: StreamEvent["storeSnapshot"]) {
  const order = snapshot.messages.order;
  const byId = snapshot.messages.byId;
  return order.map(id => {
    const message = byId[id];
    if (!message) {
      return { id, missing: true };
    }
    const parentID =
      message.metadata && typeof message.metadata === "object"
        ? (message.metadata as { parentID?: unknown }).parentID
        : undefined;
    return {
      id: message.id,
      role: message.role,
      partCount: message.parts.length,
      parentID: typeof parentID === "string" ? parentID : undefined,
    };
  });
}

export const StreamDebuggerPanel: Component<StreamDebuggerPanelProps> = props => {
  const [selectedEventID, setSelectedEventID] = createSignal<string | null>(null);
  const [showRaw, setShowRaw] = createSignal(false);

  const events = createMemo(() => props.debugger.events());
  const selectedEvent = createMemo(() => {
    const id = selectedEventID();
    if (!id) return undefined;
    return events().find(event => event.id === id);
  });

  const messageIDs = createMemo(() =>
    Array.from(
      new Set(
        events()
          .map(event => event.messageId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    )
  );

  const handleClear = () => {
    props.debugger.clear();
    setSelectedEventID(null);
  };

  return (
    <div class={cn("bg-background flex h-full flex-col", "border-border/30 border-t", props.class)}>
      <div class="border-border/30 bg-card/5 flex items-center justify-between border-b px-4 py-3">
        <div class="flex items-center gap-3">
          <span class="text-sm font-medium">Stream Debugger</span>
          <span class="text-muted-foreground text-xs">
            {events().length} events • {messageIDs().length} message IDs
          </span>
          <span class="text-muted-foreground text-xs">
            {Math.round(props.debugger.metrics().tokensPerSecond)} chars/s
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button
            onClick={() => setShowRaw(!showRaw())}
            class={cn(
              "rounded px-2 py-1 text-xs transition-colors",
              showRaw()
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            Raw
          </button>
          <button
            onClick={handleClear}
            class="bg-muted text-muted-foreground hover:bg-muted/80 rounded px-2 py-1 text-xs transition-colors"
          >
            Clear
          </button>
          <button
            onClick={props.onClose}
            class="bg-muted text-muted-foreground hover:bg-muted/80 rounded px-2 py-1 text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div class="flex flex-1 overflow-hidden">
        <div class={cn("overflow-y-auto", showRaw() ? "border-border/30 w-1/2 border-r" : "w-2/5")}>
          <Show
            when={events().length > 0}
            fallback={
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm">
                No stream events yet.
              </div>
            }
          >
            <div class="divide-border/20 divide-y">
              <For each={events()}>
                {(event, index) => (
                  <button
                    onClick={() => setSelectedEventID(event.id)}
                    class={cn(
                      "w-full px-3 py-2 text-left text-xs",
                      "hover:bg-muted/40 transition-colors",
                      selectedEventID() === event.id && "bg-primary/10"
                    )}
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-muted-foreground w-6">{index() + 1}</span>
                      <span class="w-28 font-mono">{formatTime(event.timestamp)}</span>
                      <span class="bg-muted rounded px-1.5 py-0.5 font-mono">{event.type}</span>
                    </div>
                    <div class="text-muted-foreground mt-1 font-mono">
                      {event.messageId ? `msg=${event.messageId}` : "msg=-"}
                    </div>
                    <div class="text-foreground/80 mt-1">{summarizeEvent(event)}</div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        <Show when={!showRaw()}>
          <div class="flex-1 overflow-y-auto px-4 py-3">
            <Show
              when={selectedEvent()}
              fallback={
                <div class="text-muted-foreground mt-6 text-sm">
                  Select an event to inspect payload and store state.
                </div>
              }
            >
              {event => (
                <div class="space-y-4">
                  <div>
                    <div class="text-muted-foreground text-xs uppercase">Selected Event</div>
                    <div class="mt-1 text-sm">
                      #{events().findIndex(item => item.id === event().id) + 1} {event().type}
                    </div>
                    <div class="text-muted-foreground font-mono text-xs">
                      {event().messageId ? `msg=${event().messageId}` : "msg=-"}
                    </div>
                  </div>

                  <div>
                    <div class="text-muted-foreground mb-1 text-xs uppercase">Payload</div>
                    <CollapsibleJson data={event().payload} initialDepth={2} class="text-xs" />
                  </div>

                  <div>
                    <div class="text-muted-foreground mb-1 text-xs uppercase">
                      Store Messages Snapshot
                    </div>
                    <CollapsibleJson
                      data={{
                        order: event().storeSnapshot.messages.order,
                        messages: compactMessages(event().storeSnapshot),
                      }}
                      initialDepth={2}
                      class="text-xs"
                    />
                  </div>
                </div>
              )}
            </Show>
          </div>
        </Show>

        <Show when={showRaw()}>
          <div class="w-1/2 overflow-y-auto px-3 py-2 font-mono text-xs">
            <For each={props.debugger.rawLines()}>
              {(line, index) => (
                <div class="hover:text-foreground text-muted-foreground break-all py-0.5 transition-colors">
                  <span class="text-muted-foreground/60 mr-2">{index() + 1}</span>
                  {line}
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default StreamDebuggerPanel;
