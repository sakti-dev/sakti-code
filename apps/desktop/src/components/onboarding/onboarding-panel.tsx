import { createMemo, type JSX, Show } from "solid-js";
import { MessageTimeline } from "~/components/chat/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";
import { WelcomePanel } from "./welcome-panel";

interface OnboardingPanelProps {
  intakeSessionId: string | null;
  projectId: string;
}

export function OnboardingPanel(props: OnboardingPanelProps): JSX.Element {
  const { sessions } = useStore();

  const sessionStore = () => {
    if (!props.intakeSessionId) {
      return null;
    }
    return sessions.get(props.intakeSessionId);
  };

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
      session.store.streaming.phase
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        fallback={<MessageTimeline isStreaming={isGenerating} turns={turns} />}
        when={!hasMessages()}
      >
        <WelcomePanel />
      </Show>
      <ChatInput
        placeholder="Ask anything about this project…"
        sessionId={props.intakeSessionId}
      />
    </div>
  );
}
