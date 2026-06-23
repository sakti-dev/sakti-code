import { createEffect, For, Show } from "solid-js";
import { cn } from "~/lib/utils";
import {
  healthIssues,
  lastError,
  setHealthIssues,
  setLastError,
} from "~/stores/workspace/ui-signals";

const AUTO_DISMISS_MS = 10_000;

export function BannerError() {
  const lastErr = () => lastError();

  createEffect(() => {
    const error = lastErr();
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setLastError(null), AUTO_DISMISS_MS);
    clearTimeout(timer);
  });

  return (
    <Show when={lastErr()}>
      <div class="flex items-center gap-2 bg-error/10 px-4 py-1.5 font-medium text-error text-xs">
        <svg
          aria-label="Error"
          class="h-3.5 w-3.5 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Error</title>
          <path
            clip-rule="evenodd"
            d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
          />
        </svg>
        <span class="flex-1 truncate">{lastErr()}</span>
        <button
          class="shrink-0 rounded p-0.5 transition-colors hover:bg-error/20"
          onClick={() => setLastError(null)}
          title="Dismiss"
          type="button"
        >
          <svg
            aria-label="Dismiss"
            class="h-3 w-3"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Dismiss</title>
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
          </svg>
        </button>
      </div>
    </Show>
  );
}

const HEALTH_ICONS: Record<
  string,
  { label: string; severity: "error" | "warning" }
> = {
  process_crashed: { label: "Pi process crashed", severity: "error" },
  session_start_failed: { label: "Session failed to start", severity: "error" },
  repeated_model_errors: { label: "Model errors", severity: "warning" },
};

export function BannerHealth() {
  const issues = () => healthIssues();

  const handleDismiss = () => {
    setHealthIssues([]);
  };

  return (
    <Show when={issues().length > 0}>
      <For each={issues()}>
        {(issue) => {
          const info = () =>
            HEALTH_ICONS[issue.type] ?? {
              label: issue.type,
              severity: "warning" as const,
            };
          const isError = () => info().severity === "error";

          return (
            <div
              class={cn(
                "flex items-center gap-2 px-4 py-1.5 font-medium text-xs",
                isError()
                  ? "bg-error/10 text-error"
                  : "bg-warning/10 text-warning"
              )}
            >
              <Show
                fallback={
                  <svg
                    aria-label={info().label}
                    class="h-3.5 w-3.5 shrink-0"
                    fill="currentColor"
                    role="img"
                    viewBox="0 0 16 16"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>{info().label}</title>
                    <path
                      clip-rule="evenodd"
                      d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l5.082 9.524c.633 1.187-.189 2.632-1.543 2.632H2.918c-1.354 0-2.176-1.445-1.543-2.632l5.082-9.524ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    />
                  </svg>
                }
                when={isError()}
              >
                <svg
                  aria-label={info().label}
                  class="h-3.5 w-3.5 shrink-0"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>{info().label}</title>
                  <path
                    clip-rule="evenodd"
                    d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                  />
                </svg>
              </Show>
              <span class="font-semibold">{info().label}:</span>
              <span class="min-w-0 flex-1 truncate">{issue.message}</span>
              <button
                class="shrink-0 rounded p-0.5 transition-colors hover:bg-current/10"
                onClick={handleDismiss}
                title="Dismiss"
                type="button"
              >
                <svg
                  aria-label="Dismiss"
                  class="h-3 w-3"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Dismiss</title>
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
                </svg>
              </button>
            </div>
          );
        }}
      </For>
    </Show>
  );
}
