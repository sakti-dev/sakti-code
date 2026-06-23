import { type JSX, Show } from "solid-js";
import { useStore } from "~/stores/store-context";
import {
  activeIntakeSessionId,
  replayState,
} from "~/stores/workspace/ui-signals";

export function ReplayButton(): JSX.Element {
  const { server, actions } = useStore();

  const sessionId = () =>
    server.store.activeSessionId ?? activeIntakeSessionId();

  const handleClick = () => {
    const id = sessionId();
    if (id === null) {
      return;
    }
    const state = replayState();
    if (state === "idle") {
      actions.replayStart(id);
    } else if (state === "playing") {
      actions.replayPause(id);
    } else if (state === "paused") {
      actions.replayResume(id);
    }
  };

  const handleReset = () => {
    const id = sessionId();
    if (id === null) {
      return;
    }
    actions.replayReset(id);
  };

  const label = (): string => {
    const state = replayState();
    if (state === "idle") {
      return "Replay";
    }
    if (state === "playing") {
      return "Pause";
    }
    return "Resume";
  };

  return (
    <div class="flex items-center gap-1">
      <button
        class="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
        disabled={sessionId() === null}
        onClick={handleClick}
        title="Replay recorded session"
        type="button"
      >
        {label()}
      </button>
      <Show when={replayState() !== "idle"}>
        <button
          class="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-muted-foreground text-xs transition-colors hover:bg-secondary hover:text-foreground"
          onClick={handleReset}
          title="Stop and reset replay"
          type="button"
        >
          Reset
        </button>
      </Show>
    </div>
  );
}
