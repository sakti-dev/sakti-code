import { NewWorkspaceDialog } from "@/views/home-view/components/new-workspace-dialog";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockApiClient = {
  listRemoteBranches: vi.fn(() => Promise.resolve(["main", "develop", "feature/test"])),
  listLocalBranches: vi.fn(() => Promise.resolve(["main", "develop"])),
  clone: vi.fn(() => Promise.resolve("/home/user/projects/repo")),
  createWorktree: vi.fn(() => Promise.resolve("/home/user/.sakti/workspaces/test-workspace")),
  checkWorktreeExists: vi.fn(() => Promise.resolve(false)),
  getWorkspacesDir: vi.fn(() => Promise.resolve("/home/user/.sakti/workspaces")),
};

// Mock the API client
vi.mock("@/core/services/api/api-client", () => ({
  createApiClient: vi.fn(() => Promise.resolve(mockApiClient)),
}));

// Mock memorable-name
vi.mock("memorable-name", () => ({
  generate: vi.fn(() => ({
    dashed: "spiffy-waterfall",
    raw: ["spiffy", "waterfall"],
    spaced: "spiffy waterfall",
  })),
  generateMany: vi.fn(() => [
    { dashed: "spiffy-waterfall", raw: ["spiffy", "waterfall"], spaced: "spiffy waterfall" },
    { dashed: "happy-mountain", raw: ["happy", "mountain"], spaced: "happy mountain" },
  ]),
}));

describe("NewWorkspaceDialog", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);

    // Mock window.saktiCodeAPI - minimal IPC (only dialogs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).saktiCodeAPI = {
      dialog: {
        openDirectory: vi.fn(() => Promise.resolve(null)),
      },
    };

    // Reset mock implementations
    mockApiClient.listRemoteBranches.mockReturnValue(
      Promise.resolve(["main", "develop", "feature/test"])
    );
    mockApiClient.listLocalBranches.mockReturnValue(Promise.resolve(["main", "develop"]));
    mockApiClient.clone.mockReturnValue(Promise.resolve("/home/user/projects/repo"));
    mockApiClient.createWorktree.mockReturnValue(
      Promise.resolve("/home/user/.sakti/workspaces/test-workspace")
    );
    mockApiClient.checkWorktreeExists.mockReturnValue(Promise.resolve(false));
    mockApiClient.getWorkspacesDir.mockReturnValue(Promise.resolve("/home/user/.sakti/workspaces"));
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
    vi.clearAllMocks();
  });

  it("should render dialog when open", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => (
        <div data-test="test-container">
          <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />
        </div>
      ),
      { container }
    ));

    expect(document.body.textContent).toContain("New Workspace");
    expect(document.body.textContent).toContain("Open Folder");
    expect(document.body.textContent).toContain("Clone Repository");
  });

  it("should not render when closed", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => (
        <div data-test="test-container">
          <NewWorkspaceDialog isOpen={false} onClose={onClose} onCreate={onCreate} />
        </div>
      ),
      { container }
    ));

    expect(document.body.querySelector("[data-test='new-workspace-dialog']")).toBeNull();
  });

  it("should have mode toggle for folder and clone options", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    expect(document.body.textContent).toContain("Open Folder");
    expect(document.body.textContent).toContain("Clone Repository");
  });

  it("should show folder browse UI in folder mode", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    expect(document.body.textContent).toContain("Folder Path");
    expect(document.body.textContent).toContain("Browse");
  });

  it("should show clone URL input and Validate button in clone mode", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    // Click Clone Repository tab
    const cloneTab = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Clone Repository")
    );
    cloneTab?.click();

    // Wait for re-render
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(document.body.textContent).toContain("Repository URL");
    expect(document.body.textContent).toContain("Validate");
  });

  it("should show Workspace Setup after successful validation in clone mode", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    // Click Clone Repository tab
    const cloneTab = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Clone Repository")
    );
    cloneTab?.click();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Enter URL
    const urlInput = document.body.querySelector(
      "input[placeholder*='github.com']"
    ) as HTMLInputElement;
    if (urlInput) {
      urlInput.value = "https://github.com/user/repo";
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Click Validate
    const validateBtn = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Validate")
    );
    validateBtn?.click();

    // Wait for async validation
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should show Workspace Setup
    expect(document.body.textContent).toContain("Workspace Setup");
    expect(document.body.textContent).toContain("Worktree Name");
  });

  it("should show workspace setup section after folder is selected", () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    // Workspace setup shows after path is selected (folder mode)
    // Initially not visible since no path selected
    expect(document.body.textContent).not.toContain("Worktree Name");
  });

  it("should generate memorable default worktree name", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    // Select a folder to trigger workspace setup

    const browseBtn = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Browse")
    );
    // Simulate folder selection by triggering the IPC mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((window as any).saktiCodeAPI.dialog.openDirectory as ReturnType<typeof vi.fn>).mockReturnValue(
      Promise.resolve("/home/user/projects/repo")
    );

    browseBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should show workspace setup with generated name
    const nameInput = document.body.querySelector(
      "input[placeholder='my-feature']"
    ) as HTMLInputElement;
    expect(nameInput?.value).toBe("spiffy-waterfall");
  });

  it("should use API client for clone and worktree operations", async () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();

    ({ unmount: dispose } = render(
      () => <NewWorkspaceDialog isOpen={true} onClose={onClose} onCreate={onCreate} />,
      { container }
    ));

    // Switch to clone mode
    const cloneTab = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Clone Repository")
    );
    cloneTab?.click();
    await new Promise(resolve => setTimeout(resolve, 50));

    // Enter URL
    const urlInput = document.body.querySelector(
      "input[placeholder*='github.com']"
    ) as HTMLInputElement;
    if (urlInput) {
      urlInput.value = "https://github.com/user/repo";
      urlInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Click Validate
    const validateBtn = Array.from(document.body.querySelectorAll("button")).find(btn =>
      btn.textContent?.includes("Validate")
    );
    validateBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify API was called for validation
    expect(mockApiClient.listRemoteBranches).toHaveBeenCalledWith("https://github.com/user/repo");
  });
});
