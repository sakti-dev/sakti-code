import { createMemo, type JSX, onMount, Show } from "solid-js";
import { TransitionCard } from "~/components/chat-area/parts/transition-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";

interface MissionChatViewProps {
  sessionId: string;
}

export function MissionChatView(props: MissionChatViewProps): JSX.Element {
  const { sessions, actions, server } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));
  // SessionMeta (status/changeName) lives on the server store, not the reactive
  // session store. `done` is terminal — the worktree is gone, so hide the input.
  const meta = createMemo(() => server.store.sessions[props.sessionId]);
  const isDone = () => meta()?.status === "done";

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
            <TransitionCard
              to={ask().to}
              body={ask().body}
              onApprove={() => handleAsk("approve")}
              onReject={() => handleAsk("reject")}
            />
          </div>
        )}
      </Show>
      <Show
        when={isDone()}
        fallback={<ChatInput placeholder="Continue working…" sessionId={props.sessionId} />}
      >
        <div class="px-4 pb-6 text-center text-muted-foreground text-sm">
          This mission is archived. The worktree was removed; the branch{" "}
          <code>sakti/{meta()?.changeName ?? "unknown"}</code> is retained for merge/review.
        </div>
      </Show>
    </div>
  );
}
