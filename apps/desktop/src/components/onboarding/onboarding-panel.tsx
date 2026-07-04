import {
  For,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  Show,
} from "solid-js";
import { AskCard } from "~/components/chat-area/parts/ask-card";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";
import { setTabSession } from "~/stores/workspace/tab-store";
import { EmptyState } from "./empty-state";
import { IntakeCard } from "./intake-card";

interface OnboardingPanelProps {
  projectId: string;
}

export const OnboardingPanel = (props: OnboardingPanelProps): JSX.Element => {
  const { sessions, actions } = useStore();

  const [selectedChildId, setSelectedChildId] = createSignal<string | null>(null);

  const [childrenResource, { refetch }] = createResource(
    () => props.projectId,
    async (projectId) => actions.listChildIntakes(projectId),
  );

  const handleNewIntake = async () => {
    const created = await actions.createChildIntake(props.projectId);
    if (created) {
      setSelectedChildId(created.id);
    }
  };

  const selectedStore = createMemo(() => {
    const id = selectedChildId();
    if (!id) return null;
    return sessions.get(id);
  });

  // Hydrate chat for the selected child. The lastLoadedId guard prevents
  // refetching the same session on unrelated re-renders.
  let lastLoadedId: string | null = null;
  createEffect(() => {
    const id = selectedChildId();
    if (id && id !== lastLoadedId) {
      lastLoadedId = id;
      void actions.loadChat(id);
    }
  });

  const turns = createMemo(() => selectedStore()?.store.turns ?? []);
  const hasMessages = () => turns().length > 0;

  const handleConfirmSession = async () => {
    const session = selectedStore();
    const ask = session?.store.pendingAsk;
    const childId = selectedChildId();
    if (!(session && ask && childId)) {
      return;
    }

    // Fire the server confirm first so graduation runs — the child's transcript
    // is reflected into the project's resource-scope OM before the mission
    // (spawned next) reads it. Best-effort: a graduation failure must not strand
    // the mission, so proceed regardless of the confirm result.
    await actions.confirmAsk(childId, ask.kind, ask.body, "approve");

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
    <Show
      when={selectedChildId()}
      fallback={
        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 class="font-semibold text-lg tracking-tight">Intakes</h2>
              <p class="text-muted-foreground text-xs">
                Chat with an intake to scope a mission. Each intake shares the project's memory.
              </p>
            </div>
            <button
              class="shrink-0 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
              onClick={() => void handleNewIntake()}
              type="button"
            >
              New intake
            </button>
          </div>

          <Show
            when={(childrenResource() ?? []).length > 0}
            fallback={
              <div class="flex flex-1 items-center justify-center">
                <div class="text-center">
                  <p class="text-muted-foreground text-sm">No intakes yet.</p>
                  <p class="mt-1 text-muted-foreground text-xs">
                    Click <strong>New intake</strong> to start scoping a mission.
                  </p>
                </div>
              </div>
            }
          >
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <For each={childrenResource() ?? []}>
                {(child) => (
                  <IntakeCard
                    title={child.title}
                    updatedAt={child.updatedAt}
                    onClick={() => setSelectedChildId(child.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      }
    >
      {(childId) => (
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex items-center gap-2 border-b border-border/40 px-4 py-2">
            <button
              class="text-muted-foreground text-xs transition-colors hover:text-foreground"
              onClick={() => {
                setSelectedChildId(null);
                void refetch();
              }}
              type="button"
            >
              ← Back
            </button>
          </div>
          <Show
            fallback={<MessageTimeline sessionId={childId()} turns={turns} />}
            when={!hasMessages()}
          >
            <EmptyState />
          </Show>
          <Show when={selectedStore()?.store.pendingAsk}>
            {(ask) => (
              <div class="px-4 pb-2">
                <AskCard
                  kind={ask().kind}
                  body={ask().body}
                  onApprove={handleConfirmSession}
                  onReject={() => selectedStore()?.actions.clearPendingAsk()}
                />
              </div>
            )}
          </Show>
          <ChatInput placeholder="Ask anything about this project…" sessionId={childId()} />
        </div>
      )}
    </Show>
  );
};
