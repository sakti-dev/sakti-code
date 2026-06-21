import { Show } from "solid-js";
import { connectionStore } from "~/lib/state/connection";

export default function BannerUpdate() {
  const updateAvailable = () => connectionStore.updateAvailable();
  const updateVersion = () => connectionStore.updateVersion();

  const dismiss = () => {
    connectionStore.setUpdateAvailable(false);
    connectionStore.setUpdateVersion(null);
  };

  return (
    <Show when={updateAvailable()}>
      <div class="flex items-center gap-3 bg-success/10 px-4 py-2 text-sm text-success">
        <svg
          aria-label="Update"
          class="h-4 w-4 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Update</title>
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM8 4a.75.75 0 0 1 .75.75v3.69l2.03 2.03a.75.75 0 1 1-1.06 1.06l-2.25-2.25A.75.75 0 0 1 7.25 8.75V4.75A.75.75 0 0 1 8 4Z" />
        </svg>
        <span class="flex-1 truncate font-medium">
          Update available
          <Show when={updateVersion()}> v{updateVersion()}</Show>
        </span>
        <button
          class="shrink-0 rounded bg-success/80 px-3 py-1 font-medium text-white text-xs transition-colors hover:bg-success"
          type="button"
        >
          Restart to Update
        </button>
        <button
          class="shrink-0 rounded p-0.5 transition-colors hover:bg-success/20"
          onClick={dismiss}
          title="Dismiss"
          type="button"
        >
          <svg
            aria-label="Dismiss"
            class="h-3.5 w-3.5"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Dismiss</title>
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>
    </Show>
  );
}
