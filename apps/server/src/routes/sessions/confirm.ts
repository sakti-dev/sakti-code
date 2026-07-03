import { ObservationalMemoryEngine } from "@sakti-code/agent";
import { SqliteObservationalMemoryStorage } from "@sakti-code/db";
import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { runCompact } from "../../agent/commands/compact.ts";
import { ASK_KINDS, isKnownAskKind, type AskCtx } from "../../agent/config/ask-kinds.ts";
import { resolveOmConfig } from "../../agent/config/index.ts";
import { createSessionStorage, getCtx } from "../../context.ts";

const confirmBody = Type.Object({
  action: Type.Union([Type.Literal("approve"), Type.Literal("reject")]),
  kind: Type.String(),
  body: Type.String(),
});

export const confirmRoutes = new Hono()
  .basePath("/sessions")
  .post("/:id/confirm", tbValidator("json", confirmBody), async (c): Promise<Response> => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const { action, kind, body } = c.req.valid("json");

    const existing = ctx.repos.sessions.findById(id);
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const handlers = isKnownAskKind(kind) ? ASK_KINDS[kind] : undefined;
    if (!handlers) {
      return c.json({ error: `Unknown ask kind: ${kind}` }, 400);
    }

    // Lazy context reset — only the plan-approve handler calls this, so the
    // OM/compaction resolution is deferred to that path. Branches on OM mode:
    // observe when OM is enabled, compact otherwise. The agent swap on the
    // plan→build switch invalidates the prompt cache anyway, so resetting
    // first is free and gives the build agent a clean start.
    const forceReset: AskCtx["forceReset"] = async (sid) => {
      const omConfig = resolveOmConfig(ctx, {
        id: sid,
        kind: existing.kind,
        projectId: existing.projectId,
        profileId: existing.profileId,
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
            projectId: existing.projectId,
            sessionStorage: storage,
          },
          abortSignal: abortController.signal,
        });
        await engine.forceObserve();
        ctx.log?.agent.info("plan→build: forced OM observe", { sessionId: sid });
      } else {
        await runCompact(ctx, sid);
        ctx.log?.agent.info("plan→build: forced compaction", { sessionId: sid });
      }
    };

    const askCtx: AskCtx = { sessions: ctx.repos.sessions, forceReset };
    if (action === "approve") {
      await handlers.onApprove?.(id, body, askCtx);
    } else if (handlers.onReject) {
      await handlers.onReject(id, body, askCtx);
    }

    return c.json(ctx.repos.sessions.findById(id) ?? existing);
  });
