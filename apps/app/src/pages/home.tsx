import { useNavigate } from "@solidjs/router";
import { FiFolder, FiGitBranch } from "solid-icons/fi";
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { CloneDialog } from "~/components/home/clone-dialog";
import { EmptyState } from "~/components/home/empty-state";
import { KeyboardShortcutsFooter } from "~/components/home/keyboard-shortcuts-footer";
import { ProjectCard } from "~/components/home/project-card";
import { SettingsDialog } from "~/components/settings/settings-dialog";
import { Kbd } from "~/components/ui/kbd";
import type { Project, SessionMeta } from "~/stores/server-store";
import { useStore } from "~/stores/store-context";

function filterProjects<T extends { name: string }>(
  projects: T[],
  query: string
): T[] {
  if (!query.trim()) {
    return projects;
  }
  const lowerQuery = query.toLowerCase();
  return projects.filter((p) => p.name.toLowerCase().includes(lowerQuery));
}

export default function Home() {
  const navigate = useNavigate();
  const { server, actions } = useStore();

  const [projects, setProjects] = createSignal<Project[]>([]);
  const [sessionsMap, setSessionsMap] = createSignal<
    Record<string, SessionMeta[]>
  >({});
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCloneOpen, setIsCloneOpen] = createSignal(false);

  const filteredProjects = () => filterProjects(projects(), searchQuery());

  onMount(async () => {
    await actions.loadProjects();
    const projectList = server.store.projectOrder
      .map((id) => server.store.projects[id])
      .filter((p): p is Project => !!p);
    setProjects(projectList);

    const sMap: Record<string, SessionMeta[]> = {};
    for (const p of projectList) {
      await actions.loadSessions(p.id);
      sMap[p.id] = server.store.sessionOrder
        .map((id) => server.store.sessions[id])
        .filter((s): s is SessionMeta => !!s && s.projectId === p.id);
    }
    setSessionsMap(sMap);
  });

  createEffect(() => {
    const projectList = server.store.projectOrder
      .map((id) => server.store.projects[id])
      .filter((p): p is Project => !!p);
    setProjects(projectList);
  });

  const handleOpenProject = (projectId: string) => {
    server.actions.setActiveProject(projectId);
    navigate("/workspace");
  };

  const handleOpenFolder = async () => {
    try {
      const res = await fetch("/api/dialog/folder");
      if (res.status === 501) {
        return;
      }
      const data = (await res.json()) as { folderPath: string | null };
      if (data.folderPath) {
        const project = await actions.addProject(data.folderPath);
        if (project) {
          navigate("/workspace");
        }
      }
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleCloneRepo = async (url: string) => {
    const project = await actions.addProject(url);
    if (project) {
      navigate("/workspace");
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      const searchInput = document.querySelector(
        '[data-test="search-input"]'
      ) as HTMLInputElement;
      searchInput?.focus();
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div class="flex min-h-screen flex-col bg-background">
      <div class="flex-1 overflow-auto p-4">
        <div class="mx-auto max-w-4xl">
          <div class="rounded-2xl border border-border/50 bg-card shadow-lg">
            {/* Hero Section */}
            <div class="border-border/50 border-b p-4">
              <div class="flex flex-col gap-4">
                {/* Brand Row */}
                <div class="flex items-start justify-between">
                  <div class="flex items-center gap-4">
                    <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
                      <svg
                        aria-label="Sakti"
                        class="h-5 w-5 text-primary-foreground"
                        fill="currentColor"
                        role="img"
                        viewBox="0 0 16 16"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <title>Sakti</title>
                        <path d="M1 8.74c0 .983.713 1.825 1.69 1.943.764.092 1.534.164 2.31.216v2.351a.75.75 0 0 0 1.28.53l2.51-2.51c.182-.181.427-.283.684-.293A44.137 44.137 0 0 0 12.31 10.7c.978-.128 1.69-.962 1.69-1.96V4.26c0-.998-.712-1.832-1.69-1.96A44.645 44.645 0 0 0 8 2c-1.438 0-2.86.085-4.31.3C2.713 2.428 2 3.262 2 4.26v4.48H1Z" />
                      </svg>
                    </div>
                    <div>
                      <h1 class="font-bold text-foreground text-lg tracking-tight">
                        sakti
                      </h1>
                      <p class="text-muted-foreground text-xs">
                        Privacy-focused local AI coding agent
                      </p>
                    </div>
                  </div>
                  <SettingsDialog />
                </div>

                {/* Action Cards */}
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <button
                    class="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted"
                    onClick={handleOpenFolder}
                    type="button"
                  >
                    <FiFolder class="h-6 w-6 text-muted-foreground" />
                    <div>
                      <div class="font-medium text-foreground text-sm">
                        Open Folder
                      </div>
                      <div class="text-muted-foreground text-xs">
                        Browse files
                      </div>
                    </div>
                  </button>
                  <button
                    class="flex items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all duration-200 hover:border-primary/50 hover:bg-muted"
                    onClick={() => setIsCloneOpen(true)}
                    type="button"
                  >
                    <FiGitBranch class="h-6 w-6 text-muted-foreground" />
                    <div>
                      <div class="font-medium text-foreground text-sm">
                        Clone Repository
                      </div>
                      <div class="text-muted-foreground text-xs">
                        From Git URL
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Projects Section */}
            <div class="flex flex-col">
              <div class="border-border/50 border-b p-3">
                <div class="mb-2 flex items-center justify-between">
                  <h2 class="font-semibold text-foreground text-sm">
                    Projects
                  </h2>
                  <span class="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground text-xs">
                    {filteredProjects().length}
                  </span>
                </div>

                {/* Search */}
                <div class="relative mb-3">
                  <div class="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                    <svg
                      aria-label="Search"
                      class="h-4 w-4"
                      fill="currentColor"
                      role="img"
                      viewBox="0 0 16 16"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <title>Search</title>
                      <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z" />
                    </svg>
                  </div>
                  <input
                    class="w-full rounded-xl border border-border bg-background py-2 pr-20 pl-10 text-foreground text-sm outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary"
                    data-test="search-input"
                    onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    placeholder="Search projects..."
                    type="text"
                    value={searchQuery()}
                  />
                  <div class="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground text-xs">
                    <Kbd>Ctrl + F</Kbd>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Show
                    fallback={
                      <div class="col-span-full">
                        <EmptyState
                          icon="📂"
                          subtitle="Open a folder to get started"
                          title="No projects yet"
                        />
                      </div>
                    }
                    when={filteredProjects().length > 0}
                  >
                    <For each={filteredProjects()}>
                      {(project) => (
                        <ProjectCard
                          onOpen={() => handleOpenProject(project.id)}
                          project={project}
                          sessions={sessionsMap()[project.id] ?? []}
                        />
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>

        <KeyboardShortcutsFooter />
      </div>

      <CloneDialog
        isOpen={isCloneOpen()}
        onClone={handleCloneRepo}
        onClose={() => setIsCloneOpen(false)}
      />
    </div>
  );
}
