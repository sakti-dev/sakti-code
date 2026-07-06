import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";
import { resolveOmConfig } from "./index.ts";

/**
 * Build the `forceReset` callback: forces an OM observe so the next agent
 * starts on a compacted, observation-driven context. Currently bound only
 * for the completion→review transition (build→verify) — the bias-reduction
 * move so the verify agent doesn't inherit the build agent's rationalizations.
 *
 * Extracted from the confirm route so the OM config resolution is unit-testable.
 *
 * Best-effort: if observe/reflect models aren't configured, the observe is
 * skipped — never strand the mission on a reset failure.
 */
export function buildForceReset(
  ctx: ServerContext,
  session: { id: string; kind: string; projectId: string; profileId: string | null },
): (sessionId: string) => Promise<void> {
  return async (sid) => {
    const omConfig = resolveOmConfig(ctx, {
      id: sid,
      kind: session.kind,
      projectId: session.projectId,
      profileId: session.profileId,
    });
    if (!omConfig) {
      ctx.log?.agent?.warn("build→verify: OM not configured, skipping forced observe", {
        sessionId: sid,
      });
      return;
    }
    const omStorage = new SqliteObservationalMemoryStorage(ctx.db);
    const storage = createSessionStorage(ctx, sid);
    const abortController = new AbortController();
    const engine = new ObservationalMemoryEngine({
      deps: {
        ...omConfig,
        storage: omStorage,
        sessionId: sid,
        projectId: session.projectId,
        sessionStorage: storage,
      },
      abortSignal: abortController.signal,
    });
    await engine.forceObserve();
    ctx.log?.agent?.info("build→verify: forced OM observe", { sessionId: sid });
  };
}
