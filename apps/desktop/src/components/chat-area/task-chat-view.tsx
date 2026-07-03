import { createMemo, type JSX, onMount } from "solid-js";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    void actions.loadChat(props.sessionId);
  });

  const turns = createMemo(() => sessionStore()?.store.turns ?? []);

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline sessionId={props.sessionId} turns={turns} />
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
