import { createMemo, type JSX, Show } from "solid-js";
import { ProposedSessionCard } from "~/components/chat/parts/proposed-session-card";
import { MessageTimeline } from "~/components/chat/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";
import { setTabSession } from "~/stores/workspace/tab-store";
import { WelcomePanel } from "./welcome-panel";

interface OnboardingPanelProps {
  intakeSessionId: string | null;
  projectId: string;
}

export function OnboardingPanel(props: OnboardingPanelProps): JSX.Element {
  const { server, sessions, actions } = useStore();

  const sessionStore = createMemo(() => {
    if (!props.intakeSessionId) {
      return null;
    }
    return sessions.get(props.intakeSessionId);
  });

  const hasMessages = () =>
    (sessionStore()?.store.messageOrder.length ?? 0) > 0;

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

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const proposal = session?.store.proposedSession;
    if (!(session && proposal && props.intakeSessionId)) {
      return;
    }

    const modelId = server.store.sessions[props.intakeSessionId]?.modelId ?? "";
    const taskSession = await actions.createSession(
      props.projectId,
      modelId,
      proposal.title
    );
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
        <WelcomePanel />
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
      <ChatInput
        placeholder="Ask anything about this project…"
        sessionId={props.intakeSessionId}
      />
    </div>
  );
}
