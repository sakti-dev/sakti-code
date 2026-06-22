import { createSignal, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";

function generateFilename(sessionName: string | null): string {
  const base = sessionName ?? "sakti-session";
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const timestamp = new Date().toISOString().slice(0, 10);
  return `${safe}_${timestamp}.html`;
}

export default function ExportButton() {
  const { server } = useStore();
  const [isExporting, setIsExporting] = createSignal(false);

  const hasSession = () => server.store.activeSessionId !== null;

  const handleExport = async () => {
    const sessionId = server.store.activeSessionId;
    if (!sessionId) {
      return;
    }

    setIsExporting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/export-html`);
      if (!res.ok) {
        return;
      }
      const html = await res.text();
      const session = server.store.sessions[sessionId];
      const filename = generateFilename(session?.title ?? null);

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      class={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-xs transition-colors",
        hasSession() && !isExporting()
          ? "text-muted-foreground hover:bg-secondary hover:text-foreground"
          : "cursor-not-allowed text-muted-foreground/50"
      )}
      disabled={!hasSession() || isExporting()}
      onClick={handleExport}
      title="Export session as HTML"
      type="button"
    >
      <svg
        aria-label="Export session"
        class="h-3.5 w-3.5"
        fill="currentColor"
        role="img"
        viewBox="0 0 16 16"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Export session</title>
        <path
          clip-rule="evenodd"
          d="M4.22 11.78a.75.75 0 0 1 0-1.06L7.22 7.72a.75.75 0 0 1 1.06 0l3 3a.75.75 0 1 1-1.06 1.06L8.75 10.31V14.5a.75.75 0 0 1-1.5 0v-4.19l-1.47 1.47a.75.75 0 0 1-1.06 0z"
        />
        <path d="M3.5 3.75a.75.75 0 0 0-.75.75v7c0 .414.336.75.75.75H5a.75.75 0 0 1 0 1.5H3.5A2.25 2.25 0 0 1 1.25 11.5v-7A2.25 2.25 0 0 1 3.5 2.25h9A2.25 2.25 0 0 1 14.75 4.5v7a2.25 2.25 0 0 1-2.25 2.25H11a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 0 .75-.75v-7a.75.75 0 0 0-.75-.75h-9z" />
      </svg>
      <Show fallback="Export" when={isExporting()}>
        Exporting{"\u2026"}
      </Show>
    </button>
  );
}
