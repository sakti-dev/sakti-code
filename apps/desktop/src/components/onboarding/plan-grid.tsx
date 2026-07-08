import { For, createResource, type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { openDraftPlanTab, openSessionTab } from "~/stores/workspace/session-tab-store";
import { PlanCard } from "./plan-card";
import "./plan-grid.css";

interface PlanGridProps {
  projectId: string;
}

const SUGGESTIONS = [
  { label: "Add a feature", example: "Add a dark mode toggle to the settings page" },
  { label: "Fix a bug", example: "The login form doesn't validate emails properly" },
  { label: "Plan a refactor", example: "Extract the database layer into a separate package" },
] as const;

export const PlanGrid = (props: PlanGridProps): JSX.Element => {
  const { actions } = useStore();

  const [childrenResource] = createResource(
    () => props.projectId,
    async (projectId) => actions.listChildPlans(projectId),
  );

  const handleNewPlan = () => {
    openDraftPlanTab(props.projectId);
  };

  const children = () => childrenResource() ?? [];

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div class="plan-fade-up mx-auto w-full max-w-3xl px-6 py-10">
        <div class="mb-6">
          <h1 class="font-semibold text-2xl tracking-tight">What are we building?</h1>
          <p class="mt-1.5 text-muted-foreground text-sm leading-relaxed">
            Start a plan to scope your next mission. Each plan shares the project's memory.
          </p>
        </div>

        <button
          type="button"
          onClick={handleNewPlan}
          aria-label="Start a new plan"
          class="plan-primary-card flex w-full items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 text-left"
        >
          <span class="plan-cursor" aria-hidden="true" />
          <span class="flex-1 text-base text-muted-foreground">
            Describe what you want to build…
          </span>
          <svg
            class="plan-arrow shrink-0 text-muted-foreground"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 9h9m0 0L9 5m4 4-4 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <Show
          when={children().length > 0}
          fallback={
            <div class="mt-8">
              <p class="mb-1 font-medium text-sm">Try asking about</p>
              <div class="flex flex-col">
                <For each={SUGGESTIONS}>
                  {(suggestion) => (
                    <button
                      type="button"
                      onClick={handleNewPlan}
                      class="plan-suggestion flex items-center gap-3 rounded-lg border-b border-border/50 py-3 pr-2 text-left first:border-t"
                    >
                      <div class="min-w-0 flex-1">
                        <p class="font-medium text-sm">{suggestion.label}</p>
                        <p class="mt-0.5 truncate text-muted-foreground text-xs italic">
                          {suggestion.example}
                        </p>
                      </div>
                      <svg
                        class="plan-suggestion-arrow shrink-0 text-muted-foreground"
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 7h7m0 0L7 4m3 3-3 3"
                          stroke="currentColor"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        >
          <div class="mt-8">
            <p class="mb-3 font-medium text-sm">Recent</p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <For each={children()}>
                {(child) => (
                  <PlanCard
                    title={child.title}
                    updatedAt={child.updatedAt}
                    hasPendingTransition={!!child.pendingTransitionTo}
                    onClick={() => openSessionTab(props.projectId, child.id, "plan")}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
