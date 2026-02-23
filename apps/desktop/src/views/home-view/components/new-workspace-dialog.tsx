import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createApiClient } from "@/core/services/api/api-client";
import { cn } from "@/utils";
import { generateMany } from "@sakti-code/memorable-name";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";

const LAST_CLONE_TARGET_KEY = "sakti:lastCloneTarget";

function extractProjectName(urlOrPath: string, isUrl: boolean): string {
  if (isUrl) {
    const match = urlOrPath.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[\/:]([^\/]+)/);
    return match ? match[1].toLowerCase() : "";
  }
  const parts = urlOrPath.split("/");
  return parts[parts.length - 1]?.toLowerCase() || "";
}

async function findUniqueWorktreeName(
  apiClient: Awaited<ReturnType<typeof createApiClient>>,
  workspacesDir: string,
  projectName: string,
  _baseBranch: string
): Promise<string> {
  const projectDir = `${workspacesDir}/${projectName}`;
  const candidates = generateMany(10, { words: 2 });

  for (const candidate of candidates) {
    // Check if the directory (just the memorable name) already exists
    const exists = await apiClient.checkWorktreeExists(candidate.dashed, projectDir);
    if (!exists) {
      return candidate.dashed; // Return just the memorable name
    }
  }

  return candidates[0].dashed;
}

export interface NewWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (worktreePath: string, worktreeName: string) => Promise<void>;
}

export function NewWorkspaceDialog(props: NewWorkspaceDialogProps) {
  const [mode, setMode] = createSignal<"folder" | "clone">("folder");

  // Folder mode
  const [selectedFolder, setSelectedFolder] = createSignal("");
  const [folderBranches, setFolderBranches] = createSignal<string[]>([]);
  const [isLoadingFolderBranches, setIsLoadingFolderBranches] = createSignal(false);

  // Clone mode
  const [cloneUrl, setCloneUrl] = createSignal("");
  const [cloneTarget, setCloneTarget] = createSignal("");
  const [remoteBranches, setRemoteBranches] = createSignal<string[]>([]);
  const [isValidating, setIsValidating] = createSignal(false);
  const [isValidated, setIsValidated] = createSignal(false);
  const [projectName, setProjectName] = createSignal("");

  // Shared
  const [branch, setBranch] = createSignal("");
  const [worktreeName, setWorktreeName] = createSignal("");
  const [worktreeNameError, setWorktreeNameError] = createSignal("");
  const [isCreating, setIsCreating] = createSignal(false);
  const [error, setError] = createSignal("");
  const [workspacesDir, setWorkspacesDir] = createSignal("");
  const [homeDir, setHomeDir] = createSignal("");

  let apiClient: Awaited<ReturnType<typeof createApiClient>> | null = null;
  let nameValidationTimeout: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    apiClient = await createApiClient();
    const dir = await apiClient.getWorkspacesDir();
    setWorkspacesDir(dir);
    const parts = dir.split("/");
    const home = parts.slice(0, -2).join("/");
    setHomeDir(home);
    const lastTarget = localStorage.getItem(LAST_CLONE_TARGET_KEY);
    setCloneTarget(lastTarget || home);
  });

  // Debounced worktree name validation
  createEffect(() => {
    const name = worktreeName();
    const wsDir = workspacesDir();
    const projName = projectName();

    if (!name || !wsDir || !projName) return;

    const projectDir = `${wsDir}/${projName}`;

    if (nameValidationTimeout) {
      clearTimeout(nameValidationTimeout);
    }

    nameValidationTimeout = setTimeout(async () => {
      if (!apiClient || !name) return;
      try {
        const exists = await apiClient.checkWorktreeExists(name, projectDir);
        setWorktreeNameError(exists ? "This name is already taken" : "");
      } catch {
        // Ignore validation errors
      }
    }, 300);

    onCleanup(() => {
      if (nameValidationTimeout) {
        clearTimeout(nameValidationTimeout);
      }
    });
  });

  // Update worktree name when branch changes (for memorable name)
  createEffect(async () => {
    const b = branch();
    const projName = projectName();
    const wsDir = workspacesDir();
    if (b && projName && wsDir && !worktreeName() && apiClient) {
      const uniqueName = await findUniqueWorktreeName(apiClient, wsDir, projName, b);
      setWorktreeName(uniqueName);
    }
  });

  const repoPath = createMemo(() => {
    if (mode() === "folder") {
      return selectedFolder();
    }
    return "";
  });

  const availableBranches = createMemo(() => {
    if (mode() === "folder") {
      return folderBranches();
    }
    return remoteBranches();
  });

  const suggestions = createMemo(() => {
    const name = worktreeName();
    if (name) return [];
    return ["feature", "bugfix", "hotfix"];
  });

  const fullBranchName = createMemo(() => {
    const b = branch();
    const name = worktreeName();
    if (!b || !name) return "";
    return `${b}-${name}`;
  });

  const worktreeFullPath = createMemo(() => {
    const name = worktreeName();
    const projName = projectName();
    const wsDir = workspacesDir();
    if (!name || !projName || !wsDir) return "";
    const fullPath = `${wsDir}/${projName}/${name}`;
    const home = homeDir();
    if (home && fullPath.startsWith(home)) {
      return fullPath.replace(home, "~");
    }
    return fullPath;
  });

  // Folder mode handlers
  const handleBrowseFolder = async () => {
    const path = await window.saktiCodeAPI.dialog.openDirectory();
    if (path) {
      setSelectedFolder(path);
      setError("");
      await fetchLocalBranches(path);
    }
  };

  const fetchLocalBranches = async (path: string) => {
    if (!apiClient) return;
    setIsLoadingFolderBranches(true);
    setError("");
    try {
      const branches = await apiClient.listLocalBranches(path);
      setFolderBranches(branches);
      setProjectName(extractProjectName(path, false));
      if (branches.length > 0) {
        const defaultBranch =
          branches.find(b => b === "main") || branches.find(b => b === "master") || branches[0];
        setBranch(defaultBranch);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list branches");
      setFolderBranches([]);
    } finally {
      setIsLoadingFolderBranches(false);
    }
  };

  // Clone mode handlers
  const handleBrowseCloneTarget = async () => {
    const path = await window.saktiCodeAPI.dialog.openDirectory();
    if (path) {
      setCloneTarget(path);
      localStorage.setItem(LAST_CLONE_TARGET_KEY, path);
    }
  };

  const handleValidate = async () => {
    const url = cloneUrl();
    if (!url || !apiClient) return;

    setIsValidating(true);
    setError("");
    setIsValidated(false);

    try {
      const branches = await apiClient.listRemoteBranches(url);
      setRemoteBranches(branches);
      setProjectName(extractProjectName(url, true));
      if (branches.length > 0) {
        const defaultBranch =
          branches.find(b => b === "main") || branches.find(b => b === "master") || branches[0];
        setBranch(defaultBranch);
      }
      setIsValidated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to validate repository");
      setRemoteBranches([]);
    } finally {
      setIsValidating(false);
    }
  };

  // Create workspace - creates worktree with new branch in both modes
  const handleCreate = async () => {
    const wsDir = workspacesDir();
    const projName = projectName();
    const dirName = worktreeName(); // Just the memorable name
    const branchFullName = fullBranchName(); // Full branch name (base/name)
    const b = branch(); // Base branch
    if (!wsDir || !projName || !dirName || !branchFullName || !b || !apiClient) return;

    if (worktreeNameError()) return;

    setIsCreating(true);
    setError("");

    try {
      let repoPathValue = "";

      if (mode() === "clone") {
        const url = cloneUrl();
        const target = cloneTarget();
        repoPathValue = await apiClient.clone({
          url,
          targetDir: target || homeDir(),
          branch: b,
        });
      } else {
        repoPathValue = selectedFolder();
      }

      const projectDir = `${wsDir}/${projName}`;
      const worktreePath = await apiClient.createWorktree({
        repoPath: repoPathValue,
        worktreeName: dirName, // Directory name
        branch: branchFullName, // Full branch name (base/name)
        worktreesDir: projectDir,
        createBranch: true,
      });

      await props.onCreate(worktreePath, dirName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create workspace");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setSelectedFolder("");
    setFolderBranches([]);
    setCloneUrl("");
    setRemoteBranches([]);
    setIsValidated(false);
    setBranch("");
    setWorktreeName("");
    setWorktreeNameError("");
    setError("");
    setProjectName("");
    setMode("folder");
    props.onClose();
  };

  const handleModeChange = (newMode: "folder" | "clone") => {
    setMode(newMode);
    setSelectedFolder("");
    setFolderBranches([]);
    setRemoteBranches([]);
    setIsValidated(false);
    setBranch("");
    setWorktreeName("");
    setWorktreeNameError("");
    setError("");
    setProjectName("");
  };

  const canShowWorkspaceSetup = () => {
    if (mode() === "clone") {
      return isValidated() && availableBranches().length > 0 && projectName();
    }
    return repoPath() && availableBranches().length > 0 && projectName();
  };

  const canCreate = () => {
    if (mode() === "clone") {
      return isValidated() && worktreeName() && branch() && !worktreeNameError();
    }
    return repoPath() && worktreeName() && branch() && !worktreeNameError();
  };

  return (
    <Dialog
      open={props.isOpen}
      onOpenChange={(open: boolean) => !open && handleClose()}
      modal
      data-test="new-workspace-dialog"
    >
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
        </DialogHeader>

        {/* Mode Toggle */}
        <div class="bg-muted flex gap-2 rounded-lg p-1">
          <button
            type="button"
            onClick={() => handleModeChange("folder")}
            class={cn(
              "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              mode() === "folder"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Open Folder
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("clone")}
            class={cn(
              "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
              mode() === "clone"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Clone Repository
          </button>
        </div>

        {/* Folder Mode */}
        <Show when={mode() === "folder"}>
          <div class="space-y-4">
            <div class="flex items-end gap-4">
              <div class="flex-1">
                <label class="mb-2 block text-sm font-medium">Folder Path</label>
                <input
                  type="text"
                  value={selectedFolder()}
                  readOnly
                  placeholder="Select a git repository..."
                  class={cn(
                    "border-input bg-background w-full rounded-md border px-3 py-2",
                    "text-foreground text-sm",
                    "placeholder:text-muted-foreground"
                  )}
                />
              </div>
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={isLoadingFolderBranches()}
                class={cn(
                  "bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium",
                  "hover:bg-primary/90 transition-colors duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                Browse
              </button>
            </div>

            <Show when={isLoadingFolderBranches()}>
              <p class="text-muted-foreground text-sm">Loading branches...</p>
            </Show>
          </div>
        </Show>

        {/* Clone Mode */}
        <Show when={mode() === "clone"}>
          <div class="space-y-4">
            {/* URL Input */}
            <div>
              <label class="mb-2 block text-sm font-medium">Repository URL</label>
              <input
                type="text"
                value={cloneUrl()}
                onInput={e => {
                  setCloneUrl(e.currentTarget.value);
                  setRemoteBranches([]);
                  setIsValidated(false);
                  setError("");
                }}
                placeholder="https://github.com/user/repo"
                disabled={isCreating()}
                class={cn(
                  "border-input bg-background w-full rounded-md border px-3 py-2",
                  "text-foreground text-sm",
                  "placeholder:text-muted-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              />
            </div>

            {/* Target Directory */}
            <div class="flex items-end gap-4">
              <div class="flex-1">
                <label class="mb-2 block text-sm font-medium">Clone To</label>
                <input
                  type="text"
                  value={cloneTarget()}
                  readOnly
                  placeholder={homeDir() || "Select directory..."}
                  disabled={isCreating()}
                  class={cn(
                    "border-input bg-background w-full rounded-md border px-3 py-2",
                    "text-foreground text-sm",
                    "placeholder:text-muted-foreground",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                />
              </div>
              <button
                type="button"
                onClick={handleBrowseCloneTarget}
                disabled={isCreating()}
                class={cn(
                  "bg-secondary text-secondary-foreground rounded-md px-4 py-2 text-sm font-medium",
                  "hover:bg-secondary/80 transition-colors duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                Browse
              </button>
            </div>

            {/* Validate Button */}
            <Show when={!isValidated()}>
              <button
                type="button"
                onClick={handleValidate}
                disabled={!cloneUrl() || isValidating() || isCreating()}
                class={cn(
                  "bg-secondary text-secondary-foreground w-full rounded-md px-4 py-2 text-sm font-medium",
                  "hover:bg-secondary/80 transition-colors duration-150",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {isValidating() ? "Validating..." : "Validate"}
              </button>
            </Show>

            {/* Validated Success */}
            <Show when={isValidated()}>
              <div class="rounded-md border border-green-500/20 bg-green-500/10 p-3">
                <p class="text-sm text-green-600 dark:text-green-400">
                  Repository validated successfully
                </p>
              </div>
            </Show>
          </div>
        </Show>

        {/* Error Display */}
        <Show when={error()}>
          <div class="rounded-md border border-red-500/20 bg-red-500/10 p-3">
            <p class="text-sm text-red-600 dark:text-red-400">{error()}</p>
          </div>
        </Show>

        {/* Workspace Setup - Shared by both modes */}
        <Show when={canShowWorkspaceSetup()}>
          <div data-test="workspace-setup" class="space-y-4 border-t pt-4">
            <h3 class="font-semibold">Workspace Setup</h3>

            {/* Clone To (only in clone mode) */}
            <Show when={mode() === "clone" && isValidated()}>
              <div class="text-muted-foreground text-sm">
                <span class="font-medium">Clone to:</span>
                <p class="mt-1 font-mono text-xs">{cloneTarget() || homeDir()}</p>
              </div>
            </Show>

            {/* Branch Selection */}
            <div>
              <label class="mb-2 block text-sm font-medium">Base Branch</label>
              <select
                value={branch()}
                onChange={e => {
                  setBranch(e.currentTarget.value);
                  setWorktreeName(""); // Reset worktree name to regenerate with new base
                }}
                disabled={isCreating()}
                class={cn(
                  "border-input bg-background w-full rounded-md border px-3 py-2",
                  "text-foreground text-sm"
                )}
              >
                <For each={availableBranches()}>{b => <option value={b}>{b}</option>}</For>
              </select>
              <p class="text-muted-foreground mt-1 text-xs">
                New branch will be created as: {branch()}-your-workspace-name
              </p>
            </div>

            {/* Worktree Name */}
            <div>
              <label class="mb-2 block text-sm font-medium">Worktree Name</label>
              <input
                type="text"
                value={worktreeName()}
                onInput={e => setWorktreeName(e.currentTarget.value)}
                disabled={isCreating()}
                class={cn(
                  "border-input bg-background w-full rounded-md border px-3 py-2",
                  "text-foreground text-sm",
                  "placeholder:text-muted-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  worktreeNameError() && "border-red-500"
                )}
                placeholder="my-feature"
              />
              <Show when={worktreeNameError()}>
                <p class="mt-1 text-xs text-red-500">{worktreeNameError()}</p>
              </Show>
              <Show when={fullBranchName()}>
                <p class="text-muted-foreground mt-1 text-xs">Branch: {fullBranchName()}</p>
              </Show>
            </div>

            {/* Suggestions */}
            <Show when={suggestions().length > 0}>
              <div class="text-muted-foreground text-sm">
                <span class="font-medium">Suggestions:</span>
                <ul class="ml-4 mt-1 list-inside list-disc">
                  <For each={suggestions()}>
                    {suggestion => (
                      <li>
                        <button
                          type="button"
                          onClick={() => setWorktreeName(suggestion)}
                          class="text-primary hover:underline"
                        >
                          {suggestion}
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </div>
            </Show>

            {/* Full Path Preview */}
            <Show when={worktreeFullPath()}>
              <div class="text-muted-foreground text-sm">
                <span class="font-medium">Worktree path:</span>
                <p class="mt-1 font-mono text-xs">{worktreeFullPath()}</p>
              </div>
            </Show>
          </div>
        </Show>

        <DialogFooter>
          <button
            type="button"
            onClick={handleClose}
            class={cn(
              "bg-secondary text-secondary-foreground rounded-md px-4 py-2 text-sm font-medium",
              "hover:bg-secondary/80 transition-colors duration-150"
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate() || isCreating()}
            class={cn(
              "bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium",
              "hover:bg-primary/90 transition-colors duration-150",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {isCreating() ? "Creating..." : "Create Workspace"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
