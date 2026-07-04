import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";
import { runCompact } from "../commands/compact.ts";
import { resolveOmConfig } from "./index.ts";

/**
 * Build the plan→build `forceReset` callback. Branches on whether OM is
 * enabled for the session: observe when OM is on, compact otherwise. The
 * agent swap on plan→build invalidates the prompt cache anyway, so resetting
 * first is free and gives the build agent a clean start.
 *
 * Extracted from the confirm route so the OM-on / OM-off branch is unit-testable
 * (the route wires `AskCtx.forceReset` to this).
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
    if (omConfig) {
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
      ctx.log?.agent?.info("plan→build: forced OM observe", { sessionId: sid });
    } else {
      await runCompact(ctx, sid);
      ctx.log?.agent?.info("plan→build: forced compaction", { sessionId: sid });
    }
  };
}
