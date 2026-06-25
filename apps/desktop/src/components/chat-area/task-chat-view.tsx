import { createMemo, type JSX, onMount, Show } from "solid-js";
import { RetryBanner } from "~/components/chat-area/retry-banner";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    actions.loadMessages(props.sessionId);
  });

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase,
      session.store.turnTimings
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline isStreaming={isGenerating} turns={turns} />
      <Show when={sessionStore()?.store.retry}>
        {(retry) => (
          <RetryBanner
            onCancel={() => actions.abortRun(props.sessionId)}
            retry={retry()}
          />
        )}
      </Show>
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
