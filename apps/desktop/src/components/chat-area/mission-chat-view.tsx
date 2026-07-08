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
    const result = await actions.confirmTransition(props.sessionId, ask.to, ask.body, askAction);
    if (result.ok) {
      sessionStore()?.actions.clearPendingTransition();
      // Auto-start the next phase: the server flipped the status and returned
      // the <instruction> block. Send it as a WS prompt so the next-phase
      // agent runs immediately (no manual user message needed).
      if (result.instruction) {
        actions.sendPrompt(props.sessionId, result.instruction);
      }
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
