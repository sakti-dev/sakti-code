import { getPartComponent } from "@/views/workspace-view/chat-area/part-registry";
import { registerDefaultPartComponents } from "@/views/workspace-view/chat-area/register-parts";
import { Show, type Component } from "solid-js";

export interface MessagePartProps {
  part: Record<string, unknown>;
  message?: unknown;
  hideDetails?: boolean;
  defaultOpen?: boolean;
  isStreaming?: boolean;
  onPermissionApprove?: (id: string, patterns?: string[]) => void | Promise<void>;
  onPermissionDeny?: (id: string) => void | Promise<void>;
  onQuestionAnswer?: (id: string, answer: unknown) => void | Promise<void>;
  onQuestionReject?: (id: string) => void | Promise<void>;
}

registerDefaultPartComponents();

export const Part: Component<MessagePartProps> = props => {
  const partType = () => {
    const type = props.part.type;
    return typeof type === "string" ? type : "";
  };

  const partComponent = () => getPartComponent(partType());

  return (
    <Show when={partComponent()}>
      {registered => {
        const Registered = registered();
        return (
          <Registered
            part={props.part}
            message={props.message}
            hideDetails={props.hideDetails}
            defaultOpen={props.defaultOpen}
            isStreaming={props.isStreaming}
            onPermissionApprove={props.onPermissionApprove}
            onPermissionDeny={props.onPermissionDeny}
            onQuestionAnswer={props.onQuestionAnswer}
            onQuestionReject={props.onQuestionReject}
          />
        );
      }}
    </Show>
  );
};
