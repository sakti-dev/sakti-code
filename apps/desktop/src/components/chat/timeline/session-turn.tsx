import { type Accessor, For, Index, type JSX, Show } from "solid-js";
import type { ChatTurn } from "~/stores/session/turn-projection";
import { getUserText } from "~/stores/session/turn-projection";
import type { MessagePart } from "~/stores/types.ts";
import { CHAT_COMPACT_STACK_GAP_CLASS, CHAT_STACK_GAP_CLASS } from "../layout";
import { Part } from "../parts/message-part";
import { PartFooter } from "../parts/part-footer";

export interface SessionTurnProps {
  class?: string;
  isStreaming: Accessor<boolean>;
  turn: Accessor<ChatTurn>;
}

function getPartCopyText(part: MessagePart): string | undefined {
  if (part.type === "text") {
    return part.text || undefined;
  }
  if (part.type === "thinking") {
    return part.text || undefined;
  }
  if (part.type === "tool_call") {
    return typeof part.result === "string" && part.result
      ? part.result
      : undefined;
  }
  return;
}

export function SessionTurn(props: SessionTurnProps): JSX.Element {
  const turn = props.turn;

  return (
    <div
      class={props.class}
      classList={{ [CHAT_STACK_GAP_CLASS]: true, "@container": true }}
      data-component="session-turn"
      data-slot="session-turn-root"
    >
      <Show when={turn().userMessage}>
        <div
          class="flex flex-col items-end gap-1 px-3"
          data-slot="session-turn-user"
        >
          <div class="@2xl:max-w-[450px] @4xl:max-w-[800px] max-w-[80%] rounded-2xl rounded-br-none bg-primary px-4 py-2 text-primary-foreground text-sm">
            <div class="mb-1 font-medium text-primary-foreground/70 text-xs">
              You
            </div>
            {getUserText(turn())}
          </div>
          <PartFooter
            copyText={getUserText(turn()) || undefined}
            timestamp={turn().userMessage?.timestamp ?? Date.now()}
          />
        </div>
      </Show>

      <Show when={turn().assistantMessages.length > 0}>
        <div
          class={"flex flex-col gap-3 px-3 [overflow-anchor:none]"}
          data-slot="session-turn-stream"
        >
          <Show when={turn().error && !turn().working}>
            <div class="rounded-lg bg-destructive/10 p-3 text-destructive text-sm">
              {turn().error}
            </div>
          </Show>

          <For each={turn().assistantMessages}>
            {(msg) => (
              <div class={CHAT_COMPACT_STACK_GAP_CLASS}>
                <Index each={msg.parts}>
                  {(part) => (
                    <div class="flex flex-col gap-1">
                      <Part isStreaming={props.isStreaming()} part={part()} />
                      <Show when={!part().isStreaming}>
                        <PartFooter
                          copyText={getPartCopyText(part())}
                          timestamp={msg.timestamp}
                        />
                      </Show>
                    </div>
                  )}
                </Index>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={turn().assistantMessages.length === 0 && turn().working}>
        <div class="flex items-center justify-center py-8 text-muted-foreground text-sm">
          Waiting for response…
        </div>
      </Show>
    </div>
  );
}
