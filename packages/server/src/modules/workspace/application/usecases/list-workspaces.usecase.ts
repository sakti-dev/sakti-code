import type {
  ListWorkspaceOptions,
  Workspace,
} from "../../domain/repositories/workspace.repository.js";
import { workspaceRepository } from "../../infrastructure/repositories/workspace.repository.drizzle.js";

export async function listWorkspaces(options?: ListWorkspaceOptions): Promise<Workspace[]> {
  return workspaceRepository.list(options);
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  return workspaceRepository.getById(id);
}

export async function getWorkspaceByPath(path: string): Promise<Workspace | null> {
  return workspaceRepository.getByPath(path);
}

export interface CreateWorkspaceInput {
  path: string;
  name?: string;
}

export interface CreateWorkspaceResult {
  workspace: Workspace;
  existing: boolean;
}

export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  const existing = await workspaceRepository.getByPath(input.path);
  if (existing) {
    return { workspace: existing, existing: true };
  }

  const workspace = await workspaceRepository.create(input);
  return { workspace, existing: false };
}

export interface UpdateWorkspaceInput {
  name?: string;
}

export async function updateWorkspace(
  id: string,
  input: UpdateWorkspaceInput
): Promise<Workspace | null> {
  await workspaceRepository.update(id, input);
  return workspaceRepository.getById(id);
}

export interface ArchiveWorkspaceInput {
  baseBranch?: string;
  repoPath?: string;
  isMerged?: boolean;
}

export async function archiveWorkspace(
  id: string,
  metadata?: ArchiveWorkspaceInput
): Promise<Workspace | null> {
  await workspaceRepository.archive(id, metadata);
  return workspaceRepository.getById(id);
}

export async function restoreWorkspace(id: string): Promise<Workspace | null> {
  await workspaceRepository.restore(id);
  return workspaceRepository.getById(id);
}

export async function touchWorkspace(id: string): Promise<Workspace | null> {
  await workspaceRepository.touch(id);
  return workspaceRepository.getById(id);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await workspaceRepository.delete(id);
}
