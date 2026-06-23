import { createMemo, type JSX } from "solid-js";
import { MessageTimeline } from "~/components/chat/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions } = useStore();

  const sessionStore = () => sessions.get(props.sessionId);

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline isStreaming={isGenerating} turns={turns} />
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
