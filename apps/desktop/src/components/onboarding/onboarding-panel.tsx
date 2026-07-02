import { createEffect, createMemo, type JSX, Show } from "solid-js";
import { ProposedSessionCard } from "~/components/chat-area/parts/proposed-session-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";
import { setTabSession } from "~/stores/workspace/tab-store";
import { EmptyState } from "./empty-state";

interface OnboardingPanelProps {
  intakeSessionId: string | null;
  projectId: string;
}

export const OnboardingPanel = (props: OnboardingPanelProps): JSX.Element => {
  const { sessions, actions } = useStore();

  // Hydrate intake history when the intake session becomes available.
  // intakeSessionId is set asynchronously by upsertIntakeSession()
  // (workspace-layout.tsx), so onMount would fire while it's still null —
  // react to the id becoming non-null instead. The lastLoadedId guard
  // prevents refetching the same session on unrelated re-renders.
  let lastLoadedId: string | null = null;
  createEffect(() => {
    const id = props.intakeSessionId;
    if (id && id !== lastLoadedId) {
      lastLoadedId = id;
      void actions.loadMessages(id);
    }
  });

  const sessionStore = createMemo(() => {
    if (!props.intakeSessionId) {
      return null;
    }
    return sessions.get(props.intakeSessionId);
  });

  const hasMessages = () => (sessionStore()?.store.messageOrder.length ?? 0) > 0;

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase,
      session.store.turnTimings,
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const proposal = session?.store.proposedSession;
    if (!(session && proposal && props.intakeSessionId)) {
      return;
    }

    const taskSession = await actions.createSession(props.projectId, proposal.title);
    if (!taskSession) {
      return;
    }

    session.actions.clearProposedSession();
    setTabSession(props.projectId, taskSession.id);
    actions.sendPrompt(taskSession.id, proposal.message);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        fallback={<MessageTimeline isStreaming={isGenerating} turns={turns} />}
        when={!hasMessages()}
      >
        <EmptyState />
      </Show>
      <Show when={sessionStore()?.store.proposedSession}>
        {(proposal) => (
          <div class="px-4 pb-2">
            <ProposedSessionCard
              onConfirm={handleConfirmSession}
              onReject={() => sessionStore()?.actions.clearProposedSession()}
              proposal={proposal()}
            />
          </div>
        )}
      </Show>
      <ChatInput placeholder="Ask anything about this project…" sessionId={props.intakeSessionId} />
    </div>
  );
};
