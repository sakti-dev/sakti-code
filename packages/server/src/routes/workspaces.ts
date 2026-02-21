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

const app = new Hono<Env>();

/**
 * Get workspace by path (must be before :id route)
 * GET /api/workspaces/by-path?path=
 */
app.get("/api/workspaces/by-path", async c => {
  const path = c.req.query("path");

  if (!path) {
    return c.json({ error: "Path parameter required" }, 400);
  }

  const workspace = await getWorkspaceByPath(path);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json({ workspace: serializeWorkspace(workspace) });
});

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
app.get("/api/workspaces/:id", async c => {
  const { id } = c.req.param();

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
app.post("/api/workspaces", async c => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createWorkspaceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error }, 400);
  }

  const { path, name } = parsed.data;

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
app.put("/api/workspaces/:id", async c => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateWorkspaceSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  const updateData: { name?: string } = {};
  if (parsed.data.name) {
    updateData.name = parsed.data.name;
  }

  await updateWorkspace(id, updateData);
  const updated = await getWorkspaceById(id);

  return c.json({ workspace: serializeWorkspace(updated) });
});

/**
 * Archive workspace
 * PUT /api/workspaces/:id/archive
 */
app.put("/api/workspaces/:id/archive", async c => {
  const { id } = c.req.param();
  const body = await c.req.json().catch(() => ({}));
  const parsed = archiveWorkspaceSchema.safeParse(body);

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await archiveWorkspace(id, parsed.success ? parsed.data : undefined);
  const updated = await getWorkspaceById(id);

  return c.json({ workspace: serializeWorkspace(updated) });
});

/**
 * Restore archived workspace
 * PUT /api/workspaces/:id/restore
 */
app.put("/api/workspaces/:id/restore", async c => {
  const { id } = c.req.param();

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
app.put("/api/workspaces/:id/touch", async c => {
  const { id } = c.req.param();

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
app.delete("/api/workspaces/:id", async c => {
  const { id } = c.req.param();

  const existing = await getWorkspaceById(id);
  if (!existing) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  await deleteWorkspace(id);

  return c.json({ success: true });
});

export default app;
