import { useSessionTurns } from "@/core/chat/hooks";
import { useChatContext } from "@/state/contexts/chat-provider";
import { useWorkspace } from "@/state/providers";
import { cn } from "@/utils";
import Resizable from "@corvu/resizable";
import { Component, Show, createMemo } from "solid-js";
import { ChatPerfPanel } from "./perf/chat-perf-panel";
import { MessageTimeline } from "./timeline/message-timeline";

export interface ChatAreaProps {
  class?: string;
}

export const ChatArea: Component<ChatAreaProps> = props => {
  const ctx = useWorkspace();
  const { chat } = useChatContext();

  const effectiveSessionId = createMemo(() => chat.sessionId() ?? ctx.activeSessionId());
  const turns = useSessionTurns(effectiveSessionId);

  const isStreaming = () =>
    chat.streaming.status() === "connecting" || chat.streaming.status() === "streaming";

  return (
    <Resizable.Panel
      initialSize={0.5}
      minSize={0.2}
      class={cn("bg-background relative flex h-full min-h-0 flex-1 flex-col", props.class)}
    >
      <div class={cn("flex h-full min-h-0 w-full flex-1 flex-col")}>
        <Show when={import.meta.env.DEV}>
          <ChatPerfPanel />
        </Show>

        <MessageTimeline turns={turns} isStreaming={isStreaming} />
      </div>
    </Resizable.Panel>
  );
};
