# NewWorkspaceDialog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a "New Workspace" dialog component that allows users to create workspaces via browsing folders or cloning repositories, with worktree configuration options.

**Architecture:**

- Create a reusable `NewWorkspaceDialog` component using the existing Dialog UI components
- Integrate with existing `CloneDialog` functionality for clone feature
- Support both "Open Folder" and "Clone Repository" modes in a single unified dialog
- Worktree naming with smart suggestions and path preview

**Tech Stack:**

- SolidJS with TypeScript
- Tailwind CSS v4 (existing pattern)
- lucide-solid icons (existing pattern)
- Existing Dialog components from `@/components/ui/dialog`
- TDD approach with vitest

---

## Task 1: Create NewWorkspaceDialog TypeScript Interface

**Files:**

- Create: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx` (stub with interface only)

**Step 1: Write the failing test**

```typescript
// apps/desktop/tests/unit/views/home-view/new-workspace-dialog.test.tsx
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

describe("NewWorkspaceDialog", () => {
  it("should render dialog when open", () => {
    const props = {
      isOpen: true,
      onClose: vi.fn(),
      onCreate: vi.fn(),
    };

    // This will fail - component doesn't exist yet
    expect(true).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/views/home-view/new-workspace-dialog.test.tsx --run`

**Step 3: Write minimal stub**

```typescript
// apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx
export interface NewWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (path: string, worktreeName: string, branch: string) => Promise<void>;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/views/home-view/new-workspace-dialog.test.tsx --run`

---

## Task 2: Implement NewWorkspaceDialog UI Structure

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx`

**Step 1: Write the failing test**

```typescript
// Add to test file
it("should have source selection row with folder and clone options", () => {
  // Test fails - no UI yet
  expect(false).toBe(true);
});

it("should show workspace setup section", () => {
  // Test fails - no UI yet
  expect(false).toBe(true);
});
```

**Step 2: Run test to verify it fails**

**Step 3: Write minimal implementation**

```typescript
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createSignal, Show } from "solid-js";

interface NewWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (path: string, worktreeName: string, branch: string) => Promise<void>;
}

export function NewWorkspaceDialog(props: NewWorkspaceDialogProps) {
  const [mode, setMode] = createSignal<"folder" | "clone">("folder");
  const [selectedPath, setSelectedPath] = createSignal("");
  const [worktreeName, setWorktreeName] = createSignal("");
  const [branch, setBranch] = createSignal("main");

  return (
    <Dialog open={props.isOpen} onClose={props.onClose}>
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
        </DialogHeader>

        {/* Source Selection Row */}
        <div class="flex items-end gap-4">
          {/* Left: Read-only path display */}
          <div class="flex-1">
            <div class="text-sm font-medium mb-2">
              {mode() === "folder" ? "📂 Open Folder" : "🔗 Clone Repository"}
            </div>
            <input
              type="text"
              value={selectedPath()}
              readOnly
              class="w-full bg-muted border rounded-lg px-3 py-2 text-sm"
              placeholder={mode() === "folder" ? "Select a folder..." : "https://github.com/user/repo"}
            />
          </div>

          {/* Right: Action buttons */}
          <div class="flex gap-2">
            <button
              class="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
              onClick={() => {
                // Browse folder
              }}
            >
              Browse
            </button>
            <button
              class="px-4 py-2 border border-border rounded-lg text-sm"
              onClick={() => {
                // Clone repo
              }}
            >
              Clone
            </button>
          </div>
        </div>

        {/* Workspace Setup */}
        <div class="mt-6 space-y-4">
          <h3 class="font-semibold">Workspace Setup</h3>

          {/* Branch */}
          <div>
            <label class="text-sm font-medium">Base Branch</label>
            <select
              value={branch()}
              onChange={(e) => setBranch(e.currentTarget.value)}
              class="w-full mt-1 bg-muted border rounded-lg px-3 py-2"
            >
              <option value="main">main</option>
              <option value="master">master</option>
              <option value="develop">develop</option>
            </select>
          </div>

          {/* Worktree Name */}
          <div>
            <label class="text-sm font-medium">Worktree Name</label>
            <input
              type="text"
              value={worktreeName()}
              onInput={(e) => setWorktreeName(e.currentTarget.value)}
              class="w-full mt-1 bg-muted border rounded-lg px-3 py-2"
              placeholder="my-workspace"
            />
          </div>
        </div>

        <DialogFooter>
          <button onClick={props.onClose}>Cancel</button>
          <button onClick={() => props.onCreate(selectedPath(), worktreeName(), branch())}>
            Create Workspace
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Run test to verify it passes**

---

## Task 3: Add Browse Folder Functionality

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx`

**Step 1: Write failing test**

```typescript
it("should open folder dialog when Browse is clicked", async () => {
  const onClose = vi.fn();
  // Render dialog
  // Click Browse button
  // Verify dialog.openDirectory was called
});
```

**Step 2: Implement browse handler**

```typescript
const handleBrowse = async () => {
  const path = (await window.sakti) - codeAPI.dialog.openDirectory();
  if (path) {
    setSelectedPath(path);
    // Auto-suggest worktree name from folder
    const folderName = path.split("/").pop() || "workspace";
    setWorktreeName(`${folderName}-worktree`);
  }
};
```

---

## Task 4: Add Clone Functionality

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx`
- Reference: `apps/desktop/src/views/home-view/components/clone-dialog.tsx`

**Step 1: Write failing test**

```typescript
it("should clone repository when Clone is clicked", async () => {
  // Mock the clone API
  // Click Clone with URL
  // Verify workspace cloned
});
```

**Step 2: Implement clone handler**

```typescript
const handleClone = async () => {
  try {
    const clonedPath =
      (await window.sakti) -
      codeAPI.workspace.clone({
        url: selectedPath(), // Using path field for URL
        branch: branch(),
      });
    setSelectedPath(clonedPath);
    // Auto-suggest worktree name
    const repoName = clonedPath.split("/").pop() || "workspace";
    setWorktreeName(`${repoName}-${branch()}`);
  } catch (error) {
    console.error("Clone failed:", error);
  }
};
```

---

## Task 5: Add Worktree Name Suggestions

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx`

**Step 1: Write failing test**

```typescript
it("should show worktree name suggestions", () => {
  // Should display suggestions based on folder and branch
});
```

**Step 2: Implement suggestions**

```typescript
const getSuggestions = () => {
  const folder = selectedPath().split("/").pop() || "workspace";
  return [
    `${folder}-${branch()}`,
    `${folder}-feature`,
    `workspace-${Date.now().toString().slice(-4)}`,
  ];
};
```

---

## Task 6: Add Path Preview

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/new-workspace-dialog.tsx`

**Step 1: Write failing test**

```typescript
it("should show full worktree path preview", () => {
  // Preview should show: ~/CODE/worktrees/{worktreeName}
});
```

**Step 2: Implement preview**

```typescript
const getFullPath = () => {
  return `~/CODE/worktrees/${worktreeName()}`;
};
```

---

## Task 7: Integrate NewWorkspaceDialog into home-view

**Files:**

- Modify: `apps/desktop/src/views/home-view/home-view.tsx`

**Step 1: Write failing test**

```typescript
it("should open new workspace dialog with Cmd+N", () => {
  // Press Cmd+N
  // Verify dialog opens
});
```

**Step 2: Add dialog to home-view**

```typescript
// In home-view.tsx
const [isNewWorkspaceOpen, setIsNewWorkspaceOpen] = createSignal(false);

const handleNewWorkspace = () => {
  setIsNewWorkspaceOpen(true);
};

// Add to return JSX
<NewWorkspaceDialog
  isOpen={isNewWorkspaceOpen()}
  onClose={() => setIsNewWorkspaceOpen(false)}
  onCreate={async (path, name, branch) => {
    // Add to recent projects
    const projectId = addRecentProject(path, name);
    navigate(`/workspace/${projectId}`);
    setIsNewWorkspaceOpen(false);
  }}
/>
```

---

## Task 8: Update Keyboard Shortcuts

**Files:**

- Modify: `apps/desktop/src/views/home-view/components/workspace-dashboard.tsx`
- Modify: `apps/desktop/src/views/home-view/components/keyboard-shortcuts-footer.tsx`

**Step 1: Verify keyboard handler**

Ensure `Cmd+N` triggers `onNewWorkspace` callback.

**Step 2: Update footer text**

Update to include new keyboard hint if needed.

---

## Verification Checklist

Before marking work complete:

- [ ] All tests pass (18 existing + new tests)
- [ ] Dialog opens with Cmd+N
- [ ] Browse folder works
- [ ] Clone repository works
- [ ] Worktree name suggestions appear
- [ ] Full path preview shows
- [ ] Create button creates workspace and navigates
- [ ] UI matches existing app aesthetic (Tailwind, lucide icons)
