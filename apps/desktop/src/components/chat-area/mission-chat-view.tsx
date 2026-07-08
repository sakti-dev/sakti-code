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
  const pendingTransition = () => sessionStore()?.store.pendingTransition ?? null;

  const handleAsk = async (askAction: "approve" | "reject") => {
    const ask = pendingTransition();
    if (!ask) {
      return;
    }
    // Only clear the card once the server confirms — on failure, leave it so
    // the user can retry. (The server is the source of truth; it clears the
    // persisted pending ask on both approve and reject.)
    const ok = await actions.confirmTransition(props.sessionId, ask.to, ask.body, askAction);
    if (ok) {
      sessionStore()?.actions.clearPendingTransition();
    }
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline sessionId={props.sessionId} turns={turns} />
      <Show when={pendingTransition()}>
        {(ask) => (
          <div class="px-4 pb-2">
            <AskCard
              to={ask().to}
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
