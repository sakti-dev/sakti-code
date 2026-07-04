import { createEffect, createMemo, type JSX, Show } from "solid-js";
import { AskCard } from "~/components/chat-area/parts/ask-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";
import {
  closeSessionTab,
  getSessionTabIndex,
  openSessionTab,
  promoteDraftIntake,
} from "~/stores/workspace/session-tab-store";
import { EmptyState } from "./empty-state";

interface IntakeChatProps {
  projectId: string;
  sessionId: string | null;
}

export const IntakeChat = (props: IntakeChatProps): JSX.Element => {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() =>
    props.sessionId ? sessions.get(props.sessionId) : undefined,
  );

  let lastLoadedId: string | null = null;
  createEffect(() => {
    const id = props.sessionId;
    if (id && id !== lastLoadedId) {
      lastLoadedId = id;
      void actions.loadChat(id);
    }
  });

  const turns = createMemo(() => sessionStore()?.store.turns ?? []);
  const hasMessages = () => turns().length > 0;

  const handleDraftSend = async (text: string) => {
    const created = await actions.createChildIntake(props.projectId);
    if (!created) return;
    promoteDraftIntake(props.projectId, created.id);
    actions.sendPrompt(created.id, text);
  };

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const ask = session?.store.pendingAsk;
    const sid = props.sessionId;
    if (!(session && ask && sid)) {
      return;
    }

    await actions.confirmAsk(sid, ask.kind, ask.body, "approve");

    const title =
      ask.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.slice(0, 80) ?? undefined;

    const missionSession = await actions.createSession(props.projectId, title);
    if (!missionSession) return;

    session.actions.clearPendingAsk();

    const intakeIdx = getSessionTabIndex(props.projectId, sid);
    if (intakeIdx >= 0) closeSessionTab(props.projectId, intakeIdx);
    openSessionTab(props.projectId, missionSession.id, "mission");

    actions.sendPrompt(missionSession.id, ask.body);
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        fallback={
          props.sessionId ? <MessageTimeline sessionId={props.sessionId} turns={turns} /> : null
        }
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
      <ChatInput
        placeholder="Ask anything about this project…"
        sessionId={props.sessionId}
        onSend={props.sessionId === null ? handleDraftSend : undefined}
      />
    </div>
  );
};
