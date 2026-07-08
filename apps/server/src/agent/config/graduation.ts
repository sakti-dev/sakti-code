import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";
import { resolveOmConfig } from "./index.ts";

/**
 * Build the plan-graduation callback. On the plan→mission transition gate
 * approval from a child plan, this runs a one-shot OM engine over the child's transcript with
 * `scope: "resource"` — so the engine keys its output at the project's OM slot
 * `(threadId=null, resourceId=projectId)` (engine.ts:84-88) — and force-observes
 * then force-reflects, landing the reflection in the main plan's memory.
 *
 * Mirrors `buildForceReset`. Extracted so the OM resolution is unit-testable;
 * the confirm route binds `AskCtx.graduate` to this for plan sessions only.
 *
 * Best-effort: if OM isn't configured for the project, graduation is skipped —
 * never strand the mission spawn on a reflection failure.
 *
 * Why `kind: "mission"` in the resolve call: `resolveOmConfig` gates
 * `kind === "plan"` to undefined (children run no own OM). That gate is about
 * *running* OM during a turn, not about model availability — graduation is the
 * one operation that writes the project OM from a child, so we resolve the
 * project's configured observe/reflect models by bypassing the gate.
 */
export function buildGraduation(
  ctx: ServerContext,
  childSession: { id: string; kind: string; projectId: string; profileId: string | null },
): (sessionId: string) => Promise<void> {
  return async (sid) => {
    const omConfig = resolveOmConfig(ctx, {
      id: sid,
      kind: "mission",
      projectId: childSession.projectId,
      profileId: childSession.profileId,
    });
    if (!omConfig) {
      ctx.log?.agent?.warn("plan graduation: OM not configured, skipping", {
        sessionId: sid,
        projectId: childSession.projectId,
      });
      return;
    }
    try {
      const omStorage = new SqliteObservationalMemoryStorage(ctx.db);
      const storage = createSessionStorage(ctx, sid);
      const abortController = new AbortController();
      const engine = new ObservationalMemoryEngine({
        deps: {
          ...omConfig,
          // Force resource scope so the engine writes the project's OM slot,
          // not the child's thread slot.
          scope: "resource",
          storage: omStorage,
          sessionId: sid,
          projectId: childSession.projectId,
          sessionStorage: storage,
        },
        abortSignal: abortController.signal,
      });
      await engine.forceObserve();
      await engine.forceReflect();
      ctx.log?.agent?.info("plan graduation: reflected child into project OM", {
        sessionId: sid,
        projectId: childSession.projectId,
      });
    } catch (err) {
      ctx.log?.agent?.warn("plan graduation failed (continuing)", {
        sessionId: sid,
        projectId: childSession.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
