import { type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import { WelcomePanel } from "./welcome-panel";

interface OnboardingPanelProps {
  intakeSessionId: string | null;
  projectId: string;
}

export function OnboardingPanel(props: OnboardingPanelProps): JSX.Element {
  const { sessions } = useStore();

  const hasMessages = () => {
    if (!props.intakeSessionId) {
      return false;
    }
    const sessionStore = sessions.get(props.intakeSessionId);
    return sessionStore.store.messageOrder.length > 0;
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show fallback={<WelcomePanel />} when={hasMessages()}>
        <div class="flex-1 overflow-y-auto p-4">
          <p class="text-center text-muted-foreground text-sm">
            Chat timeline coming in Phase 3
          </p>
        </div>
      </Show>
      <div class="border-border border-t p-4">
        <p class="text-center text-muted-foreground text-sm">
          Chat input coming in Phase 2
        </p>
      </div>
    </div>
  );
}
