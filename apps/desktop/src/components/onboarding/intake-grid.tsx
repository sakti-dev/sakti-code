import { For, createResource, type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { openDraftIntakeTab, openSessionTab } from "~/stores/workspace/session-tab-store";
import { IntakeCard } from "./intake-card";

interface IntakeGridProps {
  projectId: string;
}

export const IntakeGrid = (props: IntakeGridProps): JSX.Element => {
  const { actions } = useStore();

  const [childrenResource] = createResource(
    () => props.projectId,
    async (projectId) => actions.listChildIntakes(projectId),
  );

  const handleNewIntake = () => {
    openDraftIntakeTab(props.projectId);
  };

  return (
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
          onClick={() => handleNewIntake()}
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
                onClick={() => openSessionTab(props.projectId, child.id, "intake")}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
