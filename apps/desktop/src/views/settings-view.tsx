import type { RecentProject } from "@/core/chat/types";
import { createApiClient } from "@/core/services/api/api-client";
import type { ProviderClient } from "@/core/services/api/provider-client";
import { cn } from "@/utils";
import { ProviderSettings } from "@/views/components/provider-settings";
import { For, Show, createSignal, onMount } from "solid-js";

export default function SettingsView() {
  const [theme, setTheme] = createSignal<"light" | "dark">("light");
  const [recentProjects, setRecentProjects] = createSignal<RecentProject[]>([]);
  const [appVersion, setAppVersion] = createSignal<string>("");
  const [platform, setPlatform] = createSignal<string>("");
  const [providerClient, setProviderClient] = createSignal<ProviderClient | null>(null);

  onMount(async () => {
    // Load theme
    const storedTheme = localStorage.getItem("ekacode:theme");
    setTheme(storedTheme === "dark" ? "dark" : "light");

    // Load recent projects
    const stored = localStorage.getItem("ekacode:recent-projects");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Array<{
          id: string;
          name: string;
          path: string;
          lastOpened: string;
        }>;
        setRecentProjects(
          parsed.map(p => ({
            ...p,
            lastOpened: new Date(p.lastOpened),
          }))
        );
      } catch {
        setRecentProjects([]);
      }
    }

    // Get app info
    const version = await window.ekacodeAPI.app.getVersion();
    setAppVersion(version);

    const plat = await window.ekacodeAPI.app.getPlatform();
    setPlatform(plat);

    const apiClient = await createApiClient();
    setProviderClient(apiClient.getProviderClient());
  });

  const toggleTheme = () => {
    const newTheme = theme() === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("ekacode:theme", newTheme);

    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const handleRemoveProject = (project: RecentProject) => {
    const updated = recentProjects().filter(p => p.id !== project.id);
    setRecentProjects(updated);
    localStorage.setItem("ekacode:recent-projects", JSON.stringify(updated));
  };

  const handleClearAllProjects = () => {
    setRecentProjects([]);
    localStorage.removeItem("ekacode:recent-projects");
  };

  return (
    <div class="bg-background min-h-screen p-8">
      <div class="mx-auto max-w-3xl">
        {/* Header */}
        <div class="mb-8">
          <h1 class="text-foreground mb-1 text-2xl font-semibold">Settings</h1>
          <p class="text-muted-foreground text-sm">Configure your ekacode experience</p>
        </div>

        {/* Appearance Section */}
        <section class="mb-8">
          <h2 class="text-foreground mb-4 text-lg font-medium">Appearance</h2>
          <div class="bg-card border-border rounded-lg border p-4">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-foreground text-sm font-medium">Theme</h3>
                <p class="text-muted-foreground mt-0.5 text-xs">
                  {theme() === "dark" ? "Dark mode" : "Light mode"}
                </p>
              </div>
              <button
                onClick={toggleTheme}
                class={cn(
                  "relative h-6 w-12 rounded-full transition-colors duration-200",
                  "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                  theme() === "dark" ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  class={cn(
                    "absolute top-1 h-4 w-4 rounded-full bg-white transition-transform duration-200",
                    theme() === "dark" ? "left-7" : "left-1"
                  )}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Projects Section */}
        <section class="mb-8">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-foreground text-lg font-medium">Recent Projects</h2>
            <Show when={recentProjects().length > 0}>
              <button
                onClick={handleClearAllProjects}
                class={cn(
                  "text-destructive hover:text-destructive/80 text-xs font-medium",
                  "transition-colors duration-150",
                  "focus-visible:underline focus-visible:outline-none"
                )}
              >
                Clear All
              </button>
            </Show>
          </div>
          <div class="bg-card border-border divide-border divide-y rounded-lg border">
            <Show
              when={recentProjects().length > 0}
              fallback={
                <div class="p-8 text-center">
                  <p class="text-muted-foreground text-sm">No recent projects</p>
                </div>
              }
            >
              <For each={recentProjects()}>
                {project => (
                  <div class="group flex items-center justify-between p-4">
                    <div class="min-w-0 flex-1">
                      <h3 class="text-foreground truncate text-sm font-medium">{project.name}</h3>
                      <p class="text-muted-foreground mt-0.5 truncate text-xs">{project.path}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveProject(project)}
                      class={cn(
                        "opacity-0 group-hover:opacity-100",
                        "hover:bg-muted rounded p-1.5",
                        "text-muted-foreground hover:text-destructive",
                        "transition-all duration-150",
                        "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-1"
                      )}
                      aria-label="Remove project"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </section>

        {/* Server Section */}
        <section class="mb-8">
          <h2 class="text-foreground mb-4 text-lg font-medium">Server</h2>
          <div class="bg-card border-border divide-border divide-y rounded-lg border">
            <div class="flex items-center justify-between p-4">
              <div>
                <h3 class="text-foreground text-sm font-medium">Server URL</h3>
                <p class="text-muted-foreground mt-0.5 text-xs">Local API endpoint</p>
              </div>
              <code class="text-muted-foreground bg-muted rounded px-2 py-1 font-mono text-xs">
                127.0.0.1:*
              </code>
            </div>
            <div class="flex items-center justify-between p-4">
              <div>
                <h3 class="text-foreground text-sm font-medium">API Token</h3>
                <p class="text-muted-foreground mt-0.5 text-xs">Authentication token</p>
              </div>
              <code class="text-muted-foreground bg-muted rounded px-2 py-1 font-mono text-xs">
                ••••••••
              </code>
            </div>
            <div class="flex items-center justify-between p-4">
              <div>
                <h3 class="text-foreground text-sm font-medium">Connection</h3>
                <p class="text-muted-foreground mt-0.5 text-xs">Server status</p>
              </div>
              <span class="inline-flex items-center gap-1.5 text-xs font-medium text-green-600 dark:text-green-400">
                <span class="h-2 w-2 animate-pulse rounded-full bg-current" />
                Connected
              </span>
            </div>
          </div>
        </section>

        <Show when={providerClient()}>{client => <ProviderSettings client={client()} />}</Show>

        {/* About Section */}
        <section>
          <h2 class="text-foreground mb-4 text-lg font-medium">About</h2>
          <div class="bg-card border-border divide-border divide-y rounded-lg border">
            <div class="flex items-center justify-between p-4">
              <span class="text-muted-foreground text-sm">Version</span>
              <span class="text-foreground text-sm font-medium">{appVersion() || "0.0.1"}</span>
            </div>
            <div class="flex items-center justify-between p-4">
              <span class="text-muted-foreground text-sm">Platform</span>
              <span class="text-foreground text-sm font-medium">{platform() || "Unknown"}</span>
            </div>
            <div class="p-4">
              <div class="flex items-center gap-3">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  class={cn(
                    "text-muted-foreground hover:text-foreground text-sm",
                    "transition-colors duration-150",
                    "focus-visible:underline focus-visible:outline-none"
                  )}
                >
                  GitHub
                </a>
                <span class="text-muted-foreground">•</span>
                <a
                  href="https://docs.ekacode.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  class={cn(
                    "text-muted-foreground hover:text-foreground text-sm",
                    "transition-colors duration-150",
                    "focus-visible:underline focus-visible:outline-none"
                  )}
                >
                  Documentation
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
