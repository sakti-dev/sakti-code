import { createEffect, createSignal, Show } from "solid-js";
import { useStore } from "~/stores/store-context";

export default function GitStatusBar() {
  const { api, server } = useStore();
  const [branch, setBranch] = createSignal<string | null>(null);
  const [changedCount, setChangedCount] = createSignal(0);

  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (!projectId) {
      setBranch(null);
      setChangedCount(0);
      return;
    }
    const fetchGit = async () => {
      try {
        const branchRes = await api.api
          .projects({ id: projectId })
          .git.branch.get();
        if (!branchRes.error && branchRes.data) {
          setBranch(branchRes.data as string);
        }
        const statusRes = await api.api
          .projects({ id: projectId })
          .git.status.get();
        if (!statusRes.error && statusRes.data) {
          const lines = (statusRes.data as string)
            .split("\n")
            .filter((l) => l.trim());
          setChangedCount(lines.length);
        }
      } catch {
        setBranch(null);
        setChangedCount(0);
      }
    };
    fetchGit();
  });

  return (
    <Show when={branch()}>
      <div class="flex items-center gap-2 text-muted-foreground text-xs">
        <span>⎇</span>
        <span>{branch()}</span>
        <Show when={changedCount() > 0}>
          <span class="text-warning">{changedCount()} changed</span>
        </Show>
      </div>
    </Show>
  );
}
