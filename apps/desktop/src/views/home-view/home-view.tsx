import { SettingsDialog } from "@/components/settings-dialog/settings-dialog";
import type { ArchivedWorkspace, RecentProject } from "@/core/chat/types";
import { createApiClient, EkacodeApiClient, type Workspace } from "@/core/services/api/api-client";
import { useNavigate } from "@solidjs/router";
import { createSignal, onMount } from "solid-js";
import { NewWorkspaceDialog } from "./components/new-workspace-dialog";
import { WorkspaceDashboard } from "./components/workspace-dashboard";

function mapWorkspaceToRecentProject(ws: Workspace): RecentProject {
  return {
    id: ws.id,
    name: ws.name,
    path: ws.path,
    lastOpened: new Date(ws.lastOpenedAt),
  };
}

function mapWorkspaceToArchived(ws: Workspace): ArchivedWorkspace {
  return {
    id: ws.id,
    name: ws.name,
    path: ws.path,
    archivedAt: ws.archivedAt ? new Date(ws.archivedAt) : new Date(),
    isMerged: ws.isMerged,
    baseBranch: ws.baseBranch || "main",
    repoPath: ws.repoPath || ws.path,
  };
}

export default function HomeView() {
  const navigate = useNavigate();
  const [recentProjects, setRecentProjects] = createSignal<RecentProject[]>([]);
  const [archivedProjects, setArchivedProjects] = createSignal<ArchivedWorkspace[]>([]);
  const [_isDark, _setIsDark] = createSignal(false);
  const [isNewWorkspaceOpen, setIsNewWorkspaceOpen] = createSignal(false);
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(true);
  const [apiClient, setApiClient] = createSignal<EkacodeApiClient | null>(null);

  onMount(async () => {
    // Check dark mode preference
    const darkMode = localStorage.getItem("ekacode:theme") === "dark";
    _setIsDark(darkMode);
    if (darkMode) {
      document.documentElement.classList.add("dark");
    }

    // Initialize API client
    const client = await createApiClient();
    setApiClient(client);

    // Load workspaces from API
    try {
      const [activeWorkspaces, archivedWorkspaces] = await Promise.all([
        client.getWorkspaces(),
        client.getArchivedWorkspaces(),
      ]);

      setRecentProjects(activeWorkspaces.map(mapWorkspaceToRecentProject));
      setArchivedProjects(archivedWorkspaces.map(mapWorkspaceToArchived));
    } catch (error) {
      console.error("Failed to load workspaces:", error);
    } finally {
      setIsLoading(false);
    }
  });

  const handleOpenProject = async (project: RecentProject) => {
    const client = apiClient();
    if (!client) return;

    try {
      // Touch workspace to update last_opened_at
      await client.touchWorkspace(project.id);
    } catch (error) {
      console.error("Failed to touch workspace:", error);
    }

    // Navigate to workspace
    navigate(`/workspace/${project.id}`);
  };

  const handleCreateWorkspace = async (worktreePath: string, worktreeName: string) => {
    const client = apiClient();
    if (!client) return;

    try {
      // Create workspace in DB
      const workspace = await client.createWorkspace(worktreePath, worktreeName);

      // Refresh the list
      const updatedWorkspaces = await client.getWorkspaces();
      setRecentProjects(updatedWorkspaces.map(mapWorkspaceToRecentProject));

      // Close dialog and navigate
      setIsNewWorkspaceOpen(false);

      // Small delay for smooth UX
      setTimeout(() => {
        navigate(`/workspace/${workspace.id}`);
      }, 100);
    } catch (error) {
      console.error("Failed to create workspace:", error);
    }
  };

  const handleArchiveWorkspace = async (project: RecentProject) => {
    const client = apiClient();
    if (!client) return;

    try {
      // Archive workspace
      await client.archiveWorkspace(project.id, {
        baseBranch: project.gitStatus?.baseBranch || "main",
        repoPath: project.path,
      });

      // Refresh lists
      const [active, archived] = await Promise.all([
        client.getWorkspaces(),
        client.getArchivedWorkspaces(),
      ]);

      setRecentProjects(active.map(mapWorkspaceToRecentProject));
      setArchivedProjects(archived.map(mapWorkspaceToArchived));
    } catch (error) {
      console.error("Failed to archive workspace:", error);
    }
  };

  const handleRestoreWorkspace = async (workspace: ArchivedWorkspace) => {
    const client = apiClient();
    if (!client) return;

    try {
      // Restore workspace
      await client.restoreWorkspace(workspace.id);

      // Refresh lists
      const [active, archived] = await Promise.all([
        client.getWorkspaces(),
        client.getArchivedWorkspaces(),
      ]);

      setRecentProjects(active.map(mapWorkspaceToRecentProject));
      setArchivedProjects(archived.map(mapWorkspaceToArchived));
    } catch (error) {
      console.error("Failed to restore workspace:", error);
    }
  };

  const handleSearch = () => {
    const searchInput = document.querySelector('[data-test="search-input"]') as HTMLInputElement;
    searchInput?.focus();
  };

  const handleNewWorkspace = () => {
    setIsNewWorkspaceOpen(true);
  };

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
  };

  return (
    <>
      <WorkspaceDashboard
        recentWorkspaces={recentProjects()}
        archivedWorkspaces={archivedProjects()}
        onOpenWorkspace={handleOpenProject}
        onArchiveWorkspace={handleArchiveWorkspace}
        onRestoreWorkspace={handleRestoreWorkspace}
        onNewWorkspace={handleNewWorkspace}
        onSearch={handleSearch}
        onSettingsOpen={handleOpenSettings}
        isLoading={isLoading()}
      />
      <NewWorkspaceDialog
        isOpen={isNewWorkspaceOpen()}
        onClose={() => setIsNewWorkspaceOpen(false)}
        onCreate={handleCreateWorkspace}
      />
      <SettingsDialog open={isSettingsOpen()} onOpenChange={setIsSettingsOpen} />
    </>
  );
}
