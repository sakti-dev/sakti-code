import { createResource, Show } from "solid-js";
import { useStore } from "~/stores/store-context";

interface SessionStats {
  activeMessageCount: number;
  createdAt: number;
  durationMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export default function SessionStats() {
  const { api, server } = useStore();

  const [stats] = createResource(
    () => server.store.activeSessionId,
    async (sessionId) => {
      const { data, error } = await api.api
        .sessions({ id: sessionId })
        .stats.get();
      if (error || !data) {
        return null;
      }
      return data as SessionStats;
    }
  );

  return (
    <Show when={stats()}>
      <SessionStatsInner stats={stats() as SessionStats} />
    </Show>
  );
}

function SessionStatsInner(props: { stats: SessionStats }) {
  return (
    <div class="flex items-center gap-3 text-muted-foreground text-xs">
      <span>{props.stats.activeMessageCount} msgs</span>
      <span>
        {(
          props.stats.totalInputTokens + props.stats.totalOutputTokens
        ).toLocaleString()}{" "}
        tokens
      </span>
      <Show when={props.stats.totalCostUsd > 0}>
        <span>${props.stats.totalCostUsd.toFixed(4)}</span>
      </Show>
    </div>
  );
}
