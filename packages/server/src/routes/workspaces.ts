/**
 * Workspace API Routes
 *
 * Provides REST API for workspace management:
 * - GET /api/workspaces - List active workspaces
 * - GET /api/workspaces/archived - List archived workspaces
 * - GET /api/workspaces/:id - Get workspace by ID
 * - GET /api/workspaces/by-path?path= - Get workspace by path
 * - POST /api/workspaces - Create workspace
 * - PUT /api/workspaces/:id - Update workspace
 * - PUT /api/workspaces/:id/archive - Archive workspace
 * - PUT /api/workspaces/:id/restore - Restore workspace
 * - PUT /api/workspaces/:id/touch - Touch workspace (update last_opened_at)
 * - DELETE /api/workspaces/:id - Delete workspace
 */

import { Hono } from "hono";
import { z } from "zod";
import {
  archiveWorkspace,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  getWorkspaceByPath,
  listWorkspaces,
  restoreWorkspace,
  touchWorkspace,
  updateWorkspace,
} from "../../db/workspaces";
import type { Env } from "../index";
import { zValidator } from "../shared/controller/http/validators.js";

const app = new Hono<Env>();

const createWorkspaceSchema = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
});

const updateWorkspaceSchema = z.object({
  name: z.string().optional(),
});

const archiveWorkspaceSchema = z.object({
  baseBranch: z.string().optional(),
  repoPath: z.string().optional(),
  isMerged: z.boolean().optional(),
});

const workspaceIdParamSchema = z.object({
  id: z.string().min(1),
});

const workspacePathQuerySchema = z.object({
  path: z.string().min(1),
});

/**
 * Get workspace by path (must be before :id route)
 * GET /api/workspaces/by-path?path=
 */
app.get("/api/workspaces/by-path", zValidator("query", workspacePathQuerySchema), async c => {
  const { path } = c.req.valid("query");

  const workspace = await getWorkspaceByPath(path);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json({ workspace: serializeWorkspace(workspace) });
});

function serializeWorkspace(ws: Awaited<ReturnType<typeof getWorkspaceById>>) {
  if (!ws) return null;
  return {
    id: ws.id,
    path: ws.path,
    name: ws.name,
    status: ws.status,
    baseBranch: ws.baseBranch,
    repoPath: ws.repoPath,
    isMerged: ws.isMerged,
    archivedAt: ws.archivedAt?.toISOString() ?? null,
    createdAt: ws.createdAt.toISOString(),
    lastOpenedAt: ws.lastOpenedAt.toISOString(),
  };
}

/**
 * List active workspaces
 * GET /api/workspaces
 */
app.get("/api/workspaces", async c => {
  const activeWorkspaces = await listWorkspaces("active");
  return c.json({ workspaces: activeWorkspaces.map(serializeWorkspace) });
});

/**
 * List archived workspaces (must be before :id route)
 * GET /api/workspaces/archived
 */
app.get("/api/workspaces/archived", async c => {
  const archivedWorkspaces = await listWorkspaces("archived");
  return c.json({ workspaces: archivedWorkspaces.map(serializeWorkspace) });
});

/**
 * Get workspace by ID
 * GET /api/workspaces/:id
 */
app.get("/api/workspaces/:id", zValidator("param", workspaceIdParamSchema), async c => {
  const { id } = c.req.valid("param");

  const workspace = await getWorkspaceById(id);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json({ workspace: serializeWorkspace(workspace) });
});

/**
 * Create a new workspace
 * POST /api/workspaces
 */
app.post("/api/workspaces", zValidator("json", createWorkspaceSchema), async c => {
  const { path, name } = c.req.valid("json");

  // Check if workspace already exists
  const existing = await getWorkspaceByPath(path);
  if (existing) {
    return c.json({ workspace: serializeWorkspace(existing), existing: true });
  }

  const workspace = await createWorkspace({ path, name });
  return c.json({ workspace: serializeWorkspace(workspace), existing: false }, 201);
});

/**
 * Update workspace
 * PUT /api/workspaces/:id
 */
app.put(
  "/api/workspaces/:id",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", updateWorkspaceSchema),
  async c => {
    const { id } = c.req.valid("param");
    const parsed = c.req.valid("json");

    const existing = await getWorkspaceById(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const updateData: { name?: string } = {};
    if (parsed.name) {
      updateData.name = parsed.name;
    }

    await updateWorkspace(id, updateData);
    const updated = await getWorkspaceById(id);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

/**
 * Archive workspace
 * PUT /api/workspaces/:id/archive
 */
app.put(
  "/api/workspaces/:id/archive",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", archiveWorkspaceSchema),
  async c => {
    const { id } = c.req.valid("param");
    const parsed = c.req.valid("json");

    const existing = await getWorkspaceById(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    await archiveWorkspace(id, parsed);
    const updated = await getWorkspaceById(id);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

/**
 * Restore archived workspace
 * PUT /api/workspaces/:id/restore
 */
app.put("/api/workspaces/:id/restore", zValidator("param", workspaceIdParamSchema), async c => {
  const { id } = c.req.valid("param");

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await restoreWorkspace(id);
  const updated = await getWorkspaceById(id);

  return c.json({ workspace: serializeWorkspace(updated) });
});

/**
 * Touch workspace (update last_opened_at)
 * PUT /api/workspaces/:id/touch
 */
app.put("/api/workspaces/:id/touch", zValidator("param", workspaceIdParamSchema), async c => {
  const { id } = c.req.valid("param");

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await touchWorkspace(id);
  const updated = await getWorkspaceById(id);

  return c.json({ workspace: serializeWorkspace(updated) });
});

/**
 * Delete workspace
 * DELETE /api/workspaces/:id
 */
app.delete("/api/workspaces/:id", zValidator("param", workspaceIdParamSchema), async c => {
  const { id } = c.req.valid("param");

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await deleteWorkspace(id);

  return c.json({ success: true });
});

export default app;
