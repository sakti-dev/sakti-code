import { Hono } from "hono";
import { getActiveHarness, persistSkillDisabled, persistSkillEnabled } from "../../agent/runner.ts";
import { getCtx } from "../../context.ts";
import { loadAgentContext } from "../../lib/context-loader.ts";

interface SkillAnnouncePayload {
  description: string;
  filePath: string;
  name: string;
}

export const skillsRoutes = new Hono()
  .basePath("/sessions")
  // Announce a brand-new skill mid-session (file just dropped on disk).
  // Disk is source of truth — no DB write. Just tell the live harness.
  .post("/:id/skills", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }
    const body = (await c.req.json().catch(() => null)) as SkillAnnouncePayload | null;
    if (!body?.name) {
      return c.json({ error: "name is required" }, 400);
    }
    const harness = getActiveHarness(id);
    if (harness) {
      await harness.addSkill({
        name: body.name,
        description: body.description ?? "",
        content: "",
        filePath: body.filePath ?? "",
      });
    }
    return c.body(null, 204);
  })
  // Disable a skill for this session: persist DB (Layer 1) + live harness
  // effect (Layer 2). Idempotent.
  .post("/:id/skills/:name/disable", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const name = c.req.param("name");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    // Layer 1: persistent state survives restart.
    await persistSkillDisabled(ctx, id, name);

    // Layer 2: live-session cache-stable effect (deferred prompt refresh +
    // soft-disable read on the skill path). No-op if no active harness.
    const harness = getActiveHarness(id);
    if (harness) {
      await harness.removeSkill(name);
    }
    return c.body(null, 204);
  })
  // Re-enable a previously-disabled skill: remove DB entry (Layer 1) +
  // live harness effect (Layer 2). Idempotent.
  .delete("/:id/skills/:name/disable", async (c) => {
    const ctx = getCtx(c);
    const id = c.req.param("id");
    const name = c.req.param("name");
    const session = ctx.repos.sessions.findById(id);
    if (!session) {
      return c.json({ error: "Not found" }, 404);
    }

    // Layer 1: clear persistent state.
    await persistSkillEnabled(ctx, id, name);

    // Layer 2: re-add to live harness using on-disk skill data.
    const project = ctx.repos.projects.findById(session.projectId);
    if (project) {
      const loadedContext = await loadAgentContext(project.cwd);
      const skill = loadedContext.skills.find((s) => s.name === name);
      const harness = getActiveHarness(id);
      if (harness && skill) {
        await harness.addSkill(skill);
      }
    }
    // If skill is undefined or no project, silently succeed — nothing to
    // re-enable.
    return c.body(null, 204);
  });
