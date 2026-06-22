import { Show } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

export default function BannerConnection() {
  const { server } = useStore();
  const status = () => server.store.connection.status;

  return (
    <Show when={status() !== "open"}>
      <div
        class={cn(
          "flex items-center justify-center gap-2 px-4 py-1.5 font-medium text-xs",
          status() === "closed"
            ? "bg-error/10 text-error"
            : "bg-warning/10 text-warning"
        )}
      >
        <Show when={status() === "connecting"}>
          <svg
            aria-label="Connecting"
            class="h-3.5 w-3.5 shrink-0 animate-spin"
            fill="none"
            role="img"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Connecting</title>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>Connecting to server…</span>
        </Show>
        <Show when={status() === "closed"}>
          <svg
            aria-label="Disconnected"
            class="h-3.5 w-3.5 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Disconnected</title>
            <path
              clip-rule="evenodd"
              d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            />
          </svg>
          <span>Disconnected from server</span>
        </Show>
      </div>
    </Show>
  );
}
