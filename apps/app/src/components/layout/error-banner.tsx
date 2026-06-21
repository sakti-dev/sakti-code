import { For, Show } from "solid-js";
import { connectionStore } from "~/lib/state/connection";

export default function ErrorBanner() {
  const hasErrors = () =>
    connectionStore.lastError() || connectionStore.healthIssues().length > 0;

  const dismiss = () => {
    connectionStore.setError(null);
    connectionStore.setHealthIssues([]);
  };

  return (
    <Show when={hasErrors()}>
      <div class="bg-error/10 px-4 py-3 text-error text-sm">
        <div class="flex items-center justify-between">
          <div class="font-medium">Error</div>
          <button
            class="text-error/50 hover:text-error"
            onClick={dismiss}
            type="button"
          >
            ✕
          </button>
        </div>
        <Show when={connectionStore.lastError()}>
          <div class="mt-1">{connectionStore.lastError()}</div>
        </Show>
        <For each={connectionStore.healthIssues()}>
          {(issue) => (
            <div class="mt-1">
              <span class="font-medium">{issue.type}:</span> {issue.message}
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
