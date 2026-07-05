import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import type { ServerContext } from "../../context.ts";
import { createSessionStorage } from "../../context.ts";
import { resolveOmConfig } from "./index.ts";

/**
 * Build the spec→build `forceReset` callback. Forces an OM observe so the
 * build agent starts with a clean, spec-focused context. The agent swap on
 * spec→build invalidates the prompt cache anyway (system prompt + tools
 * change), so resetting first is free.
 *
 * Extracted from the confirm route so the OM config resolution is unit-testable
 * (the route wires `AskCtx.forceReset` to this).
 *
 * Best-effort: if observe/reflect models aren't configured (no API keys, no
 * profile modes), the observe is skipped — never strand the mission on a reset
 * failure. OM itself is always on; the skip is a configuration gap, not a
 * toggle.
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
      ctx.log?.agent?.warn("spec→build: OM not configured, skipping forced observe", {
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
    ctx.log?.agent?.info("spec→build: forced OM observe", { sessionId: sid });
  };
}
