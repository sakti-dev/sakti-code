import { createEffect, createMemo, type JSX, Show } from "solid-js";
import { TransitionCard } from "~/components/chat-area/parts/transition-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";
import {
  closeSessionTab,
  getSessionTabIndex,
  openSessionTab,
  promoteDraftPlan,
} from "~/stores/workspace/session-tab-store";
import { clearDraftProfile, getDraftProfile } from "~/stores/workspace/draft-profile-store";
import { EmptyState } from "./empty-state";

interface PlanChatProps {
  projectId: string;
  sessionId: string | null;
}

export const PlanChat = (props: PlanChatProps): JSX.Element => {
  const { sessions, actions, server } = useStore();

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
    const created = await actions.createChildPlan(props.projectId);
    if (!created) return;
    // Apply any pre-session profile pick (per-project draft) to the new session.
    const draftProfile = getDraftProfile(props.projectId);
    if (draftProfile) {
      await actions.selectProfile(created.id, draftProfile);
      clearDraftProfile(props.projectId);
    }
    promoteDraftPlan(props.projectId, created.id);
    actions.sendPrompt(created.id, text);
  };

  const handleConfirmSession = async () => {
    const session = sessionStore();
    const ask = session?.store.pendingTransition;
    const sid = props.sessionId;
    if (!(session && ask && sid)) {
      return;
    }

    await actions.confirmTransition(sid, ask.to, ask.body, "approve");

    // Read the changeName + worktreePath that the confirm route resolved +
    // stamped on the plan session, and carry both to the new mission.
    const planSession = server.store.sessions[sid];
    const changeName = planSession?.changeName ?? undefined;
    const worktreePath = planSession?.worktreePath ?? undefined;

    const title =
      ask.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.slice(0, 80) ?? undefined;

    const missionSession = await actions.createSession(
      props.projectId,
      title,
      changeName,
      worktreePath,
    );
    if (!missionSession) return;

    // Carry the plan session's profile over to the mission session so the
    // user's profile pick (draft or changed mid-plan) follows the work.
    const planProfileId = planSession?.profileId;
    if (planProfileId) {
      await actions.selectProfile(missionSession.id, planProfileId);
    }

    session.actions.clearPendingTransition();

    const planIdx = getSessionTabIndex(props.projectId, sid);
    if (planIdx >= 0) closeSessionTab(props.projectId, planIdx);
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
      <Show when={sessionStore()?.store.pendingTransition}>
        {(ask) => (
          <div class="px-4 pb-2">
            <TransitionCard
              to={ask().to}
              body={ask().body}
              onApprove={handleConfirmSession}
              onReject={() => sessionStore()?.actions.clearPendingTransition()}
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
