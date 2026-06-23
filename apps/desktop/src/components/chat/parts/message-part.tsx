import { type Component, Show } from "solid-js";
import { getPartComponent } from "./part-registry.ts";
import { registerDefaultPartComponents } from "./register-parts.ts";

registerDefaultPartComponents();

export interface MessagePartProps {
  isStreaming?: boolean;
  part: { type: string; [key: string]: unknown };
}

export const Part: Component<MessagePartProps> = (props) => {
  const partType = () => props.part.type;
  const partComponent = () => getPartComponent(partType());

  return (
    <Show keyed when={partComponent()}>
      {(Registered) => (
        <Registered
          isStreaming={props.isStreaming}
          part={props.part as never}
        />
      )}
    </Show>
  );
};
