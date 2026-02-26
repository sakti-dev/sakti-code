export type WorkspaceStatus = "active" | "archived";

export interface Workspace {
  id: string;
  path: string;
  name: string;
  status: WorkspaceStatus;
  baseBranch: string | null;
  repoPath: string | null;
  isMerged: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  lastOpenedAt: Date;
}

export interface CreateWorkspaceInput {
  path: string;
  name?: string;
}

export interface UpdateWorkspaceInput {
  name?: string;
}

export interface ArchiveWorkspaceInput {
  baseBranch?: string;
  repoPath?: string;
  isMerged?: boolean;
}

export interface ListWorkspaceOptions {
  status?: WorkspaceStatus;
}

export interface IWorkspaceRepository {
  create(input: CreateWorkspaceInput): Promise<Workspace>;
  getById(id: string): Promise<Workspace | null>;
  getByPath(path: string): Promise<Workspace | null>;
  list(options?: ListWorkspaceOptions): Promise<Workspace[]>;
  update(id: string, input: UpdateWorkspaceInput): Promise<void>;
  archive(id: string, metadata?: ArchiveWorkspaceInput): Promise<void>;
  restore(id: string): Promise<void>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}
