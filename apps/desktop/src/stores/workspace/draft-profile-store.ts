import { createSignal } from "solid-js";

/**
 * Per-project "draft" profile selection, used in the plan/draft view before a
 * session exists. When the user picks a profile with no live session, the
 * choice is stashed here and applied to the session once the first message
 * creates it (see `plan-chat.tsx`). Non-persistent: a reload clears drafts,
 * which is acceptable since a draft is a transient pre-session state.
 */
const [draftProfiles, setDraftProfiles] = createSignal<Record<string, string>>({});

export function getDraftProfile(projectId: string): string | undefined {
  return draftProfiles()[projectId];
}

export function setDraftProfile(projectId: string, profileId: string): void {
  setDraftProfiles((prev) => ({ ...prev, [projectId]: profileId }));
}

export function clearDraftProfile(projectId: string): void {
  setDraftProfiles((prev) => {
    if (!(projectId in prev)) {
      return prev;
    }
    const next = { ...prev };
    delete next[projectId];
    return next;
  });
}
