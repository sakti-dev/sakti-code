import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/dialog";
import { cn } from "@/utils";
import { For, Show, createSignal } from "solid-js";

interface CloneDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onClone: (url: string, branch: string) => Promise<void>;
}

// Supported git hosts for validation
const GIT_HOSTS = [
  { pattern: /github\.com/, name: "GitHub" },
  { pattern: /gitlab\.com/, name: "GitLab" },
  { pattern: /bitbucket\.org/, name: "Bitbucket" },
];

function validateGitUrl(url: string): { valid: boolean; error?: string } {
  if (!url.trim()) {
    return { valid: false, error: "URL is required" };
  }

  // Check if it matches a supported git host
  const hasSupportedHost = GIT_HOSTS.some(host => host.pattern.test(url));

  if (!hasSupportedHost) {
    return {
      valid: false,
      error: "URL must be from GitHub, GitLab, or Bitbucket",
    };
  }

  // Basic git URL pattern validation
  const gitUrlPattern = /^(https?:\/\/|git@|ssh:\/\/).*\.(git|git\/)?$/i;
  if (!gitUrlPattern.test(url) && !url.includes("/")) {
    return { valid: false, error: "Invalid git repository URL" };
  }

  return { valid: true };
}

function extractRepoName(url: string): string {
  try {
    // Remove .git suffix if present
    let cleanUrl = url.replace(/\.git$/, "");

    // Extract last path segment
    const parts = cleanUrl.split(/[/\\]/);
    return parts[parts.length - 1] || "repository";
  } catch {
    return "repository";
  }
}

export function CloneDialog(props: CloneDialogProps) {
  const [url, setUrl] = createSignal("");
  const [branch, setBranch] = createSignal("main");
  const [validation, setValidation] = createSignal<{
    valid: boolean;
    error?: string;
  }>({ valid: true });
  const [isCloning, setIsCloning] = createSignal(false);
  const [error, setError] = createSignal<string>("");
  const [successPath, setSuccessPath] = createSignal<string>("");

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setError("");

    // Validate URL
    if (value) {
      const result = validateGitUrl(value);
      setValidation(result);
    } else {
      setValidation({ valid: true });
    }
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");

    // Validate
    const check = validateGitUrl(url());
    if (!check.valid) {
      setValidation(check);
      return;
    }

    setIsCloning(true);
    try {
      await props.onClone(url(), branch());
      // Don't close yet - let the parent handle navigation
      // Show success state instead
      const repoName = extractRepoName(url());
      setSuccessPath(`~/${repoName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone repository");
    } finally {
      setIsCloning(false);
    }
  };

  const handleClose = () => {
    // Reset state
    setUrl("");
    setBranch("main");
    setValidation({ valid: true });
    setError("");
    setSuccessPath("");
    props.onClose();
  };

  const isValid = () => {
    return url().length > 0 && validation().valid;
  };

  return (
    <Dialog open={props.isOpen} onOpenChange={(open: boolean) => !open && handleClose()} modal>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clone from URL</DialogTitle>
          <DialogDescription>
            Enter a git repository URL to clone. Supports GitHub, GitLab, and Bitbucket.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} class="space-y-4">
          {/* URL Input */}
          <div>
            <label for="clone-url" class="text-foreground mb-1.5 block text-sm font-medium">
              Repository URL
            </label>
            <input
              id="clone-url"
              type="text"
              value={url()}
              onInput={e => handleUrlChange(e.currentTarget.value)}
              placeholder="https://github.com/username/repo"
              disabled={isCloning()}
              class={cn(
                "w-full rounded-md px-3 py-2",
                "bg-background border-input border",
                "text-foreground text-sm",
                "placeholder:text-muted-foreground",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                !validation().valid && "border-destructive focus-visible:ring-destructive"
              )}
              autocapitalize="off"
              autocomplete="off"
            />
            <Show when={!validation().valid && validation().error}>
              <p class="text-destructive mt-1.5 text-xs">{validation().error}</p>
            </Show>
          </div>

          {/* Branch Input */}
          <div>
            <label for="clone-branch" class="text-foreground mb-1.5 block text-sm font-medium">
              Branch (optional)
            </label>
            <input
              id="clone-branch"
              type="text"
              value={branch()}
              onInput={e => setBranch(e.currentTarget.value)}
              placeholder="main"
              disabled={isCloning()}
              class={cn(
                "w-full rounded-md px-3 py-2",
                "bg-background border-input border",
                "text-foreground text-sm",
                "placeholder:text-muted-foreground",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
              autocapitalize="off"
              autocomplete="off"
            />
            <p class="text-muted-foreground mt-1.5 text-xs">
              Defaults to <code class="text-xs">main</code> if empty
            </p>
          </div>

          {/* Supported Hosts */}
          <div class="text-muted-foreground text-xs">
            <span class="font-medium">Supported hosts:</span>{" "}
            <For each={GIT_HOSTS}>{host => <span>{host.name}</span>}</For>
          </div>

          {/* Error Message */}
          <Show when={error()}>
            <div class="bg-destructive/10 border-destructive/20 rounded-md border p-3">
              <p class="text-destructive text-sm">{error()}</p>
            </div>
          </Show>

          {/* Success Message */}
          <Show when={successPath()}>
            <div class="rounded-md border border-green-500/20 bg-green-500/10 p-3">
              <p class="text-sm text-green-600 dark:text-green-400">
                Successfully cloned to <code class="text-xs">{successPath()}</code>
              </p>
            </div>
          </Show>

          {/* Actions */}
          <DialogFooter>
            <button
              type="button"
              onClick={handleClose}
              disabled={isCloning()}
              class={cn(
                "rounded-md px-4 py-2 text-sm font-medium",
                "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                "transition-colors duration-150",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid() || isCloning() || !!successPath()}
              class={cn(
                "rounded-md px-4 py-2 text-sm font-medium",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "transition-colors duration-150",
                "focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "flex items-center gap-2"
              )}
            >
              <Show when={isCloning()}>
                <svg
                  class="animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    class="opacity-25"
                  />
                  <path
                    fill="currentColor"
                    class="opacity-75"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              </Show>
              {isCloning() ? "Cloning..." : "Clone"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
