import { createMemo, type JSX, onMount, Show } from "solid-js";
import { AskCard } from "~/components/chat-area/parts/ask-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";

interface MissionChatViewProps {
  sessionId: string;
}

export function MissionChatView(props: MissionChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    void actions.loadChat(props.sessionId);
  });

  const turns = createMemo(() => sessionStore()?.store.turns ?? []);
  const pendingAsk = () => sessionStore()?.store.pendingAsk ?? null;

  const handleAsk = (askAction: "approve" | "reject") => {
    const ask = pendingAsk();
    if (!ask) return;
    void actions.confirmAsk(props.sessionId, ask.kind, ask.body, askAction);
    sessionStore()?.actions.clearPendingAsk();
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline sessionId={props.sessionId} turns={turns} />
      <Show when={pendingAsk()}>
        {(ask) => (
          <div class="px-4 pb-2">
            <AskCard
              kind={ask().kind}
              body={ask().body}
              onApprove={() => handleAsk("approve")}
              onReject={() => handleAsk("reject")}
            />
          </div>
        )}
      </Show>
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
