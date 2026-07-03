import { type Component, Show } from "solid-js";
import type { MessagePart } from "~/stores/types.ts";
import { getPartComponent } from "./part-registry.ts";
import { registerDefaultPartComponents } from "./register-parts.ts";

registerDefaultPartComponents();

export interface MessagePartProps {
  isStreaming?: boolean;
  part: { type: string; [key: string]: unknown };
}

/**
 * Resolve whether a specific part should render as streaming.
 *
 * Part-level `isStreaming` takes precedence over message-level — the store
 * explicitly sets `isStreaming: false` on previous parts when a new part
 * starts streaming, and `isStreaming: true` on the active part. Parts loaded
 * from REST have `isStreaming: undefined`, so they fall back to the message
 * flag (which is `false` for completed messages).
 */
export function resolvePartStreaming(part: MessagePart, msgIsStreaming: boolean): boolean {
  return part.isStreaming ?? msgIsStreaming;
}

export const Part: Component<MessagePartProps> = (props) => {
  const partType = () => props.part.type;
  const partComponent = () => getPartComponent(partType());

  return (
    <Show keyed when={partComponent()}>
      {(Registered) => <Registered isStreaming={props.isStreaming} part={props.part as never} />}
    </Show>
  );
};
