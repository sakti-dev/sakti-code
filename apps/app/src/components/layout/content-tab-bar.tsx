import { cn } from "~/lib/utils";
import { activeView, setActiveView } from "~/stores/ui-signals";

export default function ContentTabBar() {
  const isChatActive = () => activeView() === "chat";

  return (
    <div
      aria-label="Content tabs"
      class="flex items-center border-border border-b bg-background"
      role="tablist"
    >
      <button
        aria-selected={isChatActive()}
        class={cn(
          "flex select-none items-center gap-1.5 border-border border-r px-3 py-1.5 font-medium text-xs transition-colors",
          isChatActive()
            ? "border-b-2 border-b-primary bg-background text-foreground"
            : "border-b-2 border-b-transparent text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        )}
        onClick={() => setActiveView("chat")}
        role="tab"
        type="button"
      >
        <svg
          aria-hidden="true"
          class="h-3.5 w-3.5 shrink-0"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            clip-rule="evenodd"
            d="M1 8.74c0 .983.713 1.825 1.69 1.943.764.092 1.534.164 2.31.216v2.351a.75.75 0 0 0 1.28.53l2.51-2.51c.182-.181.427-.283.684-.293A44.137 44.137 0 0 0 12.31 10.7c.978-.128 1.69-.962 1.69-1.96V4.26c0-.998-.712-1.832-1.69-1.96A44.645 44.645 0 0 0 8 2c-1.438 0-2.86.085-4.31.3C2.713 2.428 2 3.262 2 4.26v4.48H1Z"
          />
        </svg>
        Chat
      </button>

      <div class="flex-1" />

      <button
        class="flex items-center rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        disabled
        title="New terminal (coming soon)"
        type="button"
      >
        <svg
          aria-hidden="true"
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
        </svg>
      </button>
    </div>
  );
}
