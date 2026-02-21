/**
 * Workspace CRUD operations
 *
 * Provides workspace storage with UUIDv7 identifiers.
 */

import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db, workspaces } from "./index";

export interface CreateWorkspaceInput {
  path: string;
  name?: string;
}

export interface ArchiveWorkspaceInput {
  baseBranch?: string;
  repoPath?: string;
  isMerged?: boolean;
}

/**
 * Workspace data structure (camelCase for API)
 */
export interface WorkspaceData {
  id: string;
  path: string;
  name: string;
  status: "active" | "archived";
  baseBranch: string | null;
  repoPath: string | null;
  isMerged: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  lastOpenedAt: Date;
}

function extractNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function mapToWorkspaceData(row: {
  id: string;
  path: string;
  name: string;
  status: string;
  base_branch: string | null;
  repo_path: string | null;
  is_merged: boolean | null;
  archived_at: Date | null;
  created_at: Date;
  last_opened_at: Date;
}): WorkspaceData {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    status: row.status as "active" | "archived",
    baseBranch: row.base_branch,
    repoPath: row.repo_path,
    isMerged: row.is_merged ?? false,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

/**
 * Create a new workspace
 *
 * @param input - Workspace data
 * @returns The created workspace
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceData> {
  const id = uuidv7();
  const now = new Date();
  const name = input.name || extractNameFromPath(input.path);

  const workspace = {
    id,
    path: input.path,
    name,
    status: "active" as const,
    base_branch: null,
    repo_path: null,
    is_merged: false,
    archived_at: null,
    created_at: now,
    last_opened_at: now,
  };

  await db.insert(workspaces).values(workspace);

  return mapToWorkspaceData(workspace);
}

/**
 * Get a workspace by ID
 *
 * @param id - Workspace ID
 * @returns The workspace or null if not found
 */
export async function getWorkspaceById(id: string): Promise<WorkspaceData | null> {
  const result = await db.select().from(workspaces).where(eq(workspaces.id, id)).get();
  if (!result) return null;
  return mapToWorkspaceData(result);
}

/**
 * Get a workspace by path
 *
 * @param path - Workspace path
 * @returns The workspace or null if not found
 */
export async function getWorkspaceByPath(path: string): Promise<WorkspaceData | null> {
  const result = await db.select().from(workspaces).where(eq(workspaces.path, path)).get();
  if (!result) return null;
  return mapToWorkspaceData(result);
}

/**
 * List workspaces by status
 *
 * @param status - Optional status filter
 * @returns List of workspaces sorted by last_opened_at (ascending)
 */
export async function listWorkspaces(status?: "active" | "archived"): Promise<WorkspaceData[]> {
  const baseQuery = db.select().from(workspaces);

  let results;
  if (status) {
    results = await baseQuery
      .where(eq(workspaces.status, status))
      .orderBy(workspaces.last_opened_at)
      .all();
  } else {
    results = await baseQuery.orderBy(workspaces.last_opened_at).all();
  }

  return results.map(mapToWorkspaceData);
}

/**
 * Archive a workspace
 *
 * @param id - Workspace ID
 * @param metadata - Optional archive metadata
 */
export async function archiveWorkspace(
  id: string,
  metadata?: ArchiveWorkspaceInput
): Promise<void> {
  await db
    .update(workspaces)
    .set({
      status: "archived",
      base_branch: metadata?.baseBranch ?? null,
      repo_path: metadata?.repoPath ?? null,
      is_merged: metadata?.isMerged ?? false,
      archived_at: new Date(),
    })
    .where(eq(workspaces.id, id));
}

/**
 * Restore an archived workspace
 *
 * @param id - Workspace ID
 */
export async function restoreWorkspace(id: string): Promise<void> {
  await db
    .update(workspaces)
    .set({
      status: "active",
      base_branch: null,
      repo_path: null,
      is_merged: false,
      archived_at: null,
    })
    .where(eq(workspaces.id, id));
}

/**
 * Touch a workspace (update last_opened_at)
 *
 * @param id - Workspace ID
 */
export async function touchWorkspace(id: string): Promise<void> {
  await db.update(workspaces).set({ last_opened_at: new Date() }).where(eq(workspaces.id, id));
}

/**
 * Delete a workspace
 *
 * @param id - Workspace ID
 */
export async function deleteWorkspace(id: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, id));
}

/**
 * Update workspace fields
 *
 * @param id - Workspace ID
 * @param data - Fields to update
 */
export async function updateWorkspace(id: string, data: { name?: string }): Promise<void> {
  const updateData: { name?: string } = {};
  if (data.name !== undefined) {
    updateData.name = data.name;
  }

  if (Object.keys(updateData).length === 0) {
    return;
  }

  await db.update(workspaces).set(updateData).where(eq(workspaces.id, id));
}
