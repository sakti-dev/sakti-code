/**
 * localStorage to DB Migration Script
 *
 * Migrates workspace data from localStorage to SQLite via Hono API.
 * This runs in the Electron renderer on app startup.
 *
 * Migration strategy:
 * 1. Check if migration already completed (localStorage flag)
 * 2. Read ekacode:recent-projects → create workspaces (status=active)
 * 3. Read ekacode:archived-projects → create workspaces (status=archived)
 * 4. Set migration completed flag
 * 5. Clear old localStorage keys
 */

interface LocalStorageProject {
  id: string;
  name: string;
  path: string;
  lastOpened?: string;
  archivedAt?: string;
  isMerged?: boolean;
  baseBranch?: string;
  repoPath?: string;
}

interface MigrationResult {
  workspacesMigrated: number;
  sessionsMigrated: number;
  errors: string[];
}

const MIGRATION_FLAG = "ekacode:migration-completed";
const RECENT_PROJECTS_KEY = "ekacode:recent-projects";
const ARCHIVED_PROJECTS_KEY = "ekacode:archived-projects";

/**
 * Check if migration has already been completed
 */
function isMigrationCompleted(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return localStorage.getItem(MIGRATION_FLAG) === "true";
}

/**
 * Mark migration as completed
 */
function markMigrationCompleted(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(MIGRATION_FLAG, "true");
}

/**
 * Get recent projects from localStorage
 */
function getRecentProjects(): LocalStorageProject[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as LocalStorageProject[];
  } catch {
    return [];
  }
}

/**
 * Get archived projects from localStorage
 */
function getArchivedProjects(): LocalStorageProject[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(ARCHIVED_PROJECTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as LocalStorageProject[];
  } catch {
    return [];
  }
}

/**
 * Clear localStorage keys after migration
 */
function clearLocalStorageKeys(): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(RECENT_PROJECTS_KEY);
  localStorage.removeItem(ARCHIVED_PROJECTS_KEY);
}

/**
 * Migrate localStorage data to DB via API
 *
 * @param apiBaseUrl - Base URL for API (e.g., http://localhost:3000)
 * @returns Migration result
 */
export async function migrateLocalStorageToDb(apiBaseUrl?: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    workspacesMigrated: 0,
    sessionsMigrated: 0,
    errors: [],
  };

  // Check if already migrated
  if (isMigrationCompleted()) {
    return result;
  }

  const baseUrl = apiBaseUrl ?? "http://localhost:3000";

  // Migrate recent projects (active workspaces)
  const recentProjects = getRecentProjects();
  for (const project of recentProjects) {
    try {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: project.path,
          name: project.name,
        }),
      });

      if (!response.ok) {
        result.errors.push(`Failed to create workspace ${project.name}: ${response.statusText}`);
        continue;
      }

      result.workspacesMigrated++;
    } catch (error) {
      result.errors.push(`Error migrating workspace ${project.name}: ${String(error)}`);
    }
  }

  // Migrate archived projects
  const archivedProjects = getArchivedProjects();
  for (const project of archivedProjects) {
    try {
      // First create the workspace
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: project.path,
          name: project.name,
        }),
      });

      if (!createResponse.ok) {
        result.errors.push(
          `Failed to create archived workspace ${project.name}: ${createResponse.statusText}`
        );
        continue;
      }

      const createData = await createResponse.json();
      const workspaceId = createData.workspace?.id;

      if (!workspaceId) {
        result.errors.push(`No workspace ID returned for ${project.name}`);
        continue;
      }

      // Then archive it
      const archiveResponse = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/archive`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseBranch: project.baseBranch,
          repoPath: project.repoPath,
          isMerged: project.isMerged,
        }),
      });

      if (!archiveResponse.ok) {
        result.errors.push(
          `Failed to archive workspace ${project.name}: ${archiveResponse.statusText}`
        );
        continue;
      }

      result.workspacesMigrated++;
    } catch (error) {
      result.errors.push(`Error migrating archived workspace ${project.name}: ${String(error)}`);
    }
  }

  // Mark migration as completed and clear old keys
  if (result.errors.length === 0) {
    markMigrationCompleted();
    clearLocalStorageKeys();
  }

  return result;
}

/**
 * Force re-run migration (for debugging)
 */
export function resetMigrationFlag(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(MIGRATION_FLAG);
}
