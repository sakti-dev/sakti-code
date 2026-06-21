import { Show } from "solid-js";
import { connectionStore } from "~/lib/state/connection";

export default function BannerUpdate() {
  const dismiss = () => {
    connectionStore.setUpdateAvailable(false);
    connectionStore.setUpdateVersion(null);
  };

  return (
    <Show when={connectionStore.updateAvailable()}>
      <div class="bg-success/10 px-4 py-3 text-sm text-success">
        <div class="flex items-center justify-between">
          <div class="font-medium">
            Update available: {connectionStore.updateVersion()}
          </div>
          <div class="flex gap-2">
            <button
              class="rounded bg-success/20 px-2 py-1 hover:bg-success/30"
              type="button"
            >
              Restart to Update
            </button>
            <button
              class="text-success/50 hover:text-success"
              onClick={dismiss}
              type="button"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
