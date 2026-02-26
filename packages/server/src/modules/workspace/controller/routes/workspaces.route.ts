import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../../index.js";
import { zValidator } from "../../../../shared/controller/http/validators.js";
import {
  archiveWorkspace as archiveWorkspaceUseCase,
  createWorkspace as createWorkspaceUseCase,
  deleteWorkspace as deleteWorkspaceUseCase,
  getWorkspaceById as getWorkspaceByIdUseCase,
  getWorkspaceByPath as getWorkspaceByPathUseCase,
  listWorkspaces as listWorkspacesUseCase,
  restoreWorkspace as restoreWorkspaceUseCase,
  touchWorkspace as touchWorkspaceUseCase,
  updateWorkspace as updateWorkspaceUseCase,
} from "../../application/usecases/list-workspaces.usecase.js";

const workspacesApp = new Hono<Env>();

function serializeWorkspace(ws: Awaited<ReturnType<typeof getWorkspaceByIdUseCase>>) {
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

workspacesApp.get(
  "/api/workspaces/by-path",
  zValidator("query", workspacePathQuerySchema),
  async c => {
    const { path } = c.req.valid("query");

    const workspace = await getWorkspaceByPathUseCase(path);
    if (!workspace) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    return c.json({ workspace: serializeWorkspace(workspace) });
  }
);

workspacesApp.get("/api/workspaces", async c => {
  const activeWorkspaces = await listWorkspacesUseCase({ status: "active" });
  return c.json({ workspaces: activeWorkspaces.map(serializeWorkspace) });
});

workspacesApp.get("/api/workspaces/archived", async c => {
  const archivedWorkspaces = await listWorkspacesUseCase({ status: "archived" });
  return c.json({ workspaces: archivedWorkspaces.map(serializeWorkspace) });
});

workspacesApp.get("/api/workspaces/:id", zValidator("param", workspaceIdParamSchema), async c => {
  const { id } = c.req.valid("param");

  const workspace = await getWorkspaceByIdUseCase(id);
  if (!workspace) {
    return c.json({ error: "Workspace not found" }, 404);
  }

  return c.json({ workspace: serializeWorkspace(workspace) });
});

workspacesApp.post("/api/workspaces", zValidator("json", createWorkspaceSchema), async c => {
  const { path, name } = c.req.valid("json");

  const result = await createWorkspaceUseCase({ path, name });
  return c.json(
    { workspace: serializeWorkspace(result.workspace), existing: result.existing },
    result.existing ? 200 : 201
  );
});

workspacesApp.put(
  "/api/workspaces/:id",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", updateWorkspaceSchema),
  async c => {
    const { id } = c.req.valid("param");
    const parsed = c.req.valid("json");

    const existing = await getWorkspaceByIdUseCase(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const updateData: { name?: string } = {};
    if (parsed.name) {
      updateData.name = parsed.name;
    }

    const updated = await updateWorkspaceUseCase(id, updateData);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

workspacesApp.put(
  "/api/workspaces/:id/archive",
  zValidator("param", workspaceIdParamSchema),
  zValidator("json", archiveWorkspaceSchema),
  async c => {
    const { id } = c.req.valid("param");
    const parsed = c.req.valid("json");

    const existing = await getWorkspaceByIdUseCase(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const updated = await archiveWorkspaceUseCase(id, parsed);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

workspacesApp.put(
  "/api/workspaces/:id/restore",
  zValidator("param", workspaceIdParamSchema),
  async c => {
    const { id } = c.req.valid("param");

    const existing = await getWorkspaceByIdUseCase(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const updated = await restoreWorkspaceUseCase(id);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

workspacesApp.put(
  "/api/workspaces/:id/touch",
  zValidator("param", workspaceIdParamSchema),
  async c => {
    const { id } = c.req.valid("param");

    const existing = await getWorkspaceByIdUseCase(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    const updated = await touchWorkspaceUseCase(id);

    return c.json({ workspace: serializeWorkspace(updated) });
  }
);

workspacesApp.delete(
  "/api/workspaces/:id",
  zValidator("param", workspaceIdParamSchema),
  async c => {
    const { id } = c.req.valid("param");

    const existing = await getWorkspaceByIdUseCase(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, 404);
    }

    await deleteWorkspaceUseCase(id);

    return c.json({ success: true });
  }
);

export { workspacesApp };
