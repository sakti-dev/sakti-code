import { createEffect, createMemo, type JSX, Show } from "solid-js";
import { AskCard } from "~/components/chat-area/parts/ask-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
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
      void actions.loadChat(id);
    }
  });

  const sessionStore = createMemo(() => {
    if (!props.intakeSessionId) {
      return null;
    }
    return sessions.get(props.intakeSessionId);
  });

  const hasMessages = () => (sessionStore()?.store.turns.length ?? 0) > 0;

  const turns = createMemo(() => sessionStore()?.store.turns ?? []);

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const ask = session?.store.pendingAsk;
    if (!(session && ask && props.intakeSessionId)) {
      return;
    }

    // Derive a short title from the brief's first non-empty line.
    const title =
      ask.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.slice(0, 80) ?? undefined;

    const missionSession = await actions.createSession(props.projectId, title);
    if (!missionSession) {
      return;
    }

    session.actions.clearPendingAsk();
    setTabSession(props.projectId, missionSession.id);
    actions.sendPrompt(missionSession.id, ask.body);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        fallback={<MessageTimeline sessionId={props.intakeSessionId ?? ""} turns={turns} />}
        when={!hasMessages()}
      >
        <EmptyState />
      </Show>
      <Show when={sessionStore()?.store.pendingAsk}>
        {(ask) => (
          <div class="px-4 pb-2">
            <AskCard
              kind={ask().kind}
              body={ask().body}
              onApprove={handleConfirmSession}
              onReject={() => sessionStore()?.actions.clearPendingAsk()}
            />
          </div>
        )}
      </Show>
      <ChatInput placeholder="Ask anything about this project…" sessionId={props.intakeSessionId} />
    </div>
  );
};
