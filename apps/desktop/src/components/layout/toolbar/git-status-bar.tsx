import { createEffect, createSignal, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { activeView, setActiveView } from "~/stores/workspace/ui-signals";

export default function GitStatusBar() {
  const { api, server } = useStore();
  const [branch, setBranch] = createSignal<string | null>(null);
  const [changedCount, setChangedCount] = createSignal(0);
  const [loading, setLoading] = createSignal(false);

  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (!projectId) {
      setBranch(null);
      setChangedCount(0);
      return;
    }
    const fetchGit = async () => {
      setLoading(true);
      try {
        const branchRes = await api.api.projects[":id"].git.branch.$get({
          param: { id: projectId },
        });
        if (branchRes.ok) {
          setBranch((await branchRes.json()) as string);
        }
        const statusRes = await api.api.projects[":id"].git.status.$get({
          param: { id: projectId },
        });
        if (statusRes.ok) {
          const lines = ((await statusRes.json()) as string)
            .split("\n")
            .filter((l) => l.trim());
          setChangedCount(lines.length);
        }
      } catch {
        setBranch(null);
        setChangedCount(0);
      } finally {
        setLoading(false);
      }
    };
    fetchGit();
  });

  const isConnected = () => server.store.connection.status === "open";
  const hasSession = () => server.store.activeSessionId !== null;
  const isDirty = () => changedCount() > 0;
  const gitPanelOpen = () => activeView() === "git";

  const toggleGitPanel = () => {
    setActiveView((prev) => (prev === "git" ? "chat" : "git"));
  };

  if (!(isConnected() && hasSession())) {
    return null;
  }

  const changedCountValue = changedCount();

  return (
    <div class="flex items-center gap-1.5">
      <button
        class={cn(
          "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
          gitPanelOpen() && "bg-secondary text-foreground",
          loading() && "animate-pulse"
        )}
        onClick={toggleGitPanel}
        title={
          branch()
            ? `Branch: ${branch()} — click to toggle git panel`
            : "Detached HEAD — click to toggle git panel"
        }
        type="button"
      >
        <svg
          aria-label="Git branch"
          class="h-3.5 w-3.5 shrink-0"
          fill="currentColor"
          role="img"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>Git branch</title>
          <path
            clip-rule="evenodd"
            d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25zM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM3.5 3.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"
          />
        </svg>
        <span class="max-w-[120px] truncate">{branch() ?? "HEAD"}</span>
      </button>

      <Show when={isDirty() && changedCountValue > 0}>
        <button
          class={cn(
            "flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] tabular-nums transition-colors",
            "text-warning/80 hover:bg-secondary hover:text-warning",
            gitPanelOpen() && "bg-secondary text-warning"
          )}
          onClick={toggleGitPanel}
          title={`${String(changedCountValue)} changed file${changedCountValue === 1 ? "" : "s"} — click to toggle git panel`}
          type="button"
        >
          <svg
            aria-label="Changed files"
            class="h-3 w-3 shrink-0"
            fill="currentColor"
            role="img"
            viewBox="0 0 16 16"
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Changed files</title>
            <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" />
          </svg>
          <span>{changedCountValue}</span>
        </button>
      </Show>

      <Show when={!isDirty()}>
        <div class="flex items-center px-1" title="Working tree clean">
          <div class="h-1.5 w-1.5 rounded-full bg-success/60" />
        </div>
      </Show>
    </div>
  );
}
