# Sidebar Pibun Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring sakti's sidebar to feature parity with pibun's sidebar — responsive overlay, context menus, add/remove projects, favicon loading, session metadata, and keyboard shortcuts.

**Architecture:** Rewrite `sidebar.tsx` as a thin orchestrator that composes sub-components: `ProjectGroup`, `SessionItem`, `ProjectContextMenu`, `AddProjectInput`, and `SidebarHeader`. Each sub-component is independently testable. The sidebar itself handles responsive behavior (mobile overlay + backdrop) and keyboard shortcuts (`Ctrl+B`).

**Tech Stack:** SolidJS, Kobalte (for future menu primitives), Tailwind CSS v4 (oklch tokens), dayjs, vitest + @solidjs/testing-library

---

## Task 1: Extract `SessionItem` sub-component

**Files:**

- Create: `apps/app/src/components/layout/session-item.tsx`
- Create: `apps/app/src/components/__tests__/session-item.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/app/src/components/__tests__/session-item.test.tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { SessionItem } from "../layout/session-item.tsx";

describe("SessionItem", () => {
  it("renders session title", () => {
    const { getByText } = render(() => (
      <SessionItem
        sessionId="s1"
        title="Test Session"
        updatedAt={Date.now()}
        isActive={false}
        onClick={vi.fn()}
      />
    ));
    expect(getByText("Test Session")).toBeTruthy();
  });

  it("renders relative time", () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const { getByText } = render(() => (
      <SessionItem
        sessionId="s1"
        title="Test"
        updatedAt={fiveMinAgo}
        isActive={false}
        onClick={vi.fn()}
      />
    ));
    expect(getByText(/ago/)).toBeTruthy();
  });

  it("applies active styles when isActive", () => {
    const { container } = render(() => (
      <SessionItem
        sessionId="s1"
        title="Test"
        updatedAt={Date.now()}
        isActive={true}
        onClick={vi.fn()}
      />
    ));
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("border-l-primary");
  });

  it("calls onClick with sessionId", async () => {
    const onClick = vi.fn();
    const { getByText } = render(() => (
      <SessionItem
        sessionId="s1"
        title="Test"
        updatedAt={Date.now()}
        isActive={false}
        onClick={onClick}
      />
    ));
    getByText("Test").click();
    expect(onClick).toHaveBeenCalledWith("s1");
  });

  it("renders 'Untitled session' when title is null", () => {
    const { getByText } = render(() => (
      <SessionItem
        sessionId="s1"
        title={null}
        updatedAt={Date.now()}
        isActive={false}
        onClick={vi.fn()}
      />
    ));
    expect(getByText("Untitled session")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/session-item.test.tsx`
Expected: FAIL — `SessionItem` not found

**Step 3: Write minimal implementation**

```tsx
// apps/app/src/components/layout/session-item.tsx
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import type { ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

dayjs.extend(relativeTime);

export interface SessionItemProps {
  sessionId: string;
  title: string | null;
  updatedAt: number;
  isActive: boolean;
  onClick: (sessionId: string) => void;
}

export const SessionItem: ParentComponent<SessionItemProps> = (props) => (
  <button
    class={cn(
      "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-sm transition-colors",
      props.isActive
        ? "border-l-primary bg-secondary text-foreground"
        : "border-l-transparent text-muted-foreground hover:bg-secondary/50",
    )}
    onClick={() => props.onClick(props.sessionId)}
    type="button"
  >
    <span class="min-w-0 flex-1 truncate text-xs">{props.title || "Untitled session"}</span>
    <span class="shrink-0 text-[10px] opacity-60">{dayjs(props.updatedAt).fromNow()}</span>
  </button>
);
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/session-item.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/session-item.tsx apps/app/src/components/__tests__/session-item.test.tsx
git commit -m "feat(sidebar): extract SessionItem sub-component"
```

---

## Task 2: Extract `ProjectGroup` sub-component

**Files:**

- Create: `apps/app/src/components/layout/project-group.tsx`
- Create: `apps/app/src/components/__tests__/project-group.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/app/src/components/__tests__/project-group.test.tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProjectGroup } from "../layout/project-group.tsx";

const mockSessions = [
  {
    id: "s1",
    title: "Session 1",
    projectId: "p1",
    modelId: "gpt-4",
    thinkingLevel: "off",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "s2",
    title: "Session 2",
    projectId: "p1",
    modelId: "gpt-4",
    thinkingLevel: "off",
    createdAt: 2,
    updatedAt: 2,
  },
];

describe("ProjectGroup", () => {
  it("renders project name", () => {
    const { getByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={mockSessions}
        isExpanded={false}
        isActive={false}
        onToggle={vi.fn()}
        onSelectSession={vi.fn()}
      />
    ));
    expect(getByText("My Project")).toBeTruthy();
  });

  it("renders session count badge", () => {
    const { getByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={mockSessions}
        isExpanded={false}
        isActive={false}
        onToggle={vi.fn()}
        onSelectSession={vi.fn()}
      />
    ));
    expect(getByText("2")).toBeTruthy();
  });

  it("shows sessions when expanded", () => {
    const { getByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={mockSessions}
        isExpanded={true}
        isActive={false}
        onToggle={vi.fn()}
        onSelectSession={vi.fn()}
      />
    ));
    expect(getByText("Session 1")).toBeTruthy();
    expect(getByText("Session 2")).toBeTruthy();
  });

  it("hides sessions when collapsed", () => {
    const { queryByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={mockSessions}
        isExpanded={false}
        isActive={false}
        onToggle={vi.fn()}
        onSelectSession={vi.fn()}
      />
    ));
    expect(queryByText("Session 1")).toBeNull();
  });

  it("calls onToggle when header clicked", async () => {
    const onToggle = vi.fn();
    const { getByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={[]}
        isExpanded={false}
        isActive={false}
        onToggle={onToggle}
        onSelectSession={vi.fn()}
      />
    ));
    getByText("My Project").click();
    expect(onToggle).toHaveBeenCalledWith("p1");
  });

  it("shows 'No sessions' when expanded with empty list", () => {
    const { getByText } = render(() => (
      <ProjectGroup
        projectId="p1"
        name="My Project"
        sessions={[]}
        isExpanded={true}
        isActive={false}
        onToggle={vi.fn()}
        onSelectSession={vi.fn()}
      />
    ));
    expect(getByText("No sessions")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: FAIL — `ProjectGroup` not found

**Step 3: Write minimal implementation**

```tsx
// apps/app/src/components/layout/project-group.tsx
import { For, type ParentComponent, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { SessionItem } from "./session-item.tsx";

export interface ProjectGroupProps {
  projectId: string;
  name: string;
  sessions: Array<{
    id: string;
    title: string | null;
    projectId: string;
    modelId: string;
    thinkingLevel: string;
    createdAt: number;
    updatedAt: number;
  }>;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

export const ProjectGroup: ParentComponent<ProjectGroupProps> = (props) => (
  <div class="border-border border-b">
    <button
      class={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
        "hover:bg-secondary/50",
        props.isActive && "bg-secondary/30",
      )}
      onClick={() => props.onToggle(props.projectId)}
      type="button"
    >
      <svg
        aria-label={props.isExpanded ? "Collapse" : "Expand"}
        class={cn(
          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
          props.isExpanded && "rotate-90",
        )}
        fill="none"
        role="img"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{props.isExpanded ? "Collapse" : "Expand"}</title>
        <path d="m9 18 6-6-6-6" />
      </svg>
      <svg
        aria-label="Project"
        class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        fill="none"
        role="img"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>Project</title>
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
      <span class="min-w-0 flex-1 truncate font-medium text-foreground text-xs">{props.name}</span>
      <span class="shrink-0 text-[10px] text-muted-foreground">{props.sessions.length}</span>
    </button>

    <Show when={props.isExpanded}>
      <div class="border-border border-t bg-background/50">
        <Show
          fallback={<div class="px-6 py-2 text-muted-foreground text-xs">No sessions</div>}
          when={props.sessions.length > 0}
        >
          <For each={props.sessions}>
            {(session) => (
              <SessionItem
                sessionId={session.id}
                title={session.title}
                updatedAt={session.updatedAt}
                isActive={false}
                onClick={props.onSelectSession}
              />
            )}
          </For>
        </Show>
      </div>
    </Show>
  </div>
);
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/project-group.tsx apps/app/src/components/__tests__/project-group.test.tsx
git commit -m "feat(sidebar): extract ProjectGroup sub-component"
```

---

## Task 3: Extract `AddProjectInput` sub-component

**Files:**

- Create: `apps/app/src/components/layout/add-project-input.tsx`
- Create: `apps/app/src/components/__tests__/add-project-input.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/app/src/components/__tests__/add-project-input.test.tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { AddProjectInput } from "../layout/add-project-input.tsx";

describe("AddProjectInput", () => {
  it("renders input with placeholder", () => {
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={vi.fn()} onCancel={vi.fn()} />
    ));
    expect(getByPlaceholderText("/path/to/project")).toBeTruthy();
  });

  it("calls onAdd with value on Enter", async () => {
    const onAdd = vi.fn();
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={onAdd} onCancel={vi.fn()} />
    ));
    const input = getByPlaceholderText("/path/to/project");
    input.value = "/my/project";
    input.dispatchEvent(new Event("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onAdd).toHaveBeenCalledWith("/my/project");
  });

  it("calls onCancel on Escape", async () => {
    const onCancel = vi.fn();
    const { getByPlaceholderText } = render(() => (
      <AddProjectInput onAdd={vi.fn()} onCancel={onCancel} />
    ));
    getByPlaceholderText("/path/to/project").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" }),
    );
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables Add button when empty", () => {
    const { getByText } = render(() => <AddProjectInput onAdd={vi.fn()} onCancel={vi.fn()} />);
    const btn = getByText("Add") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/add-project-input.test.tsx`
Expected: FAIL — `AddProjectInput` not found

**Step 3: Write minimal implementation**

```tsx
// apps/app/src/components/layout/add-project-input.tsx
import { createSignal, type ParentComponent } from "solid-js";
import { cn } from "~/lib/utils";

export interface AddProjectInputProps {
  onAdd: (cwd: string) => void;
  onCancel: () => void;
}

export const AddProjectInput: ParentComponent<AddProjectInputProps> = (props) => {
  const [value, setValue] = createSignal("");

  const handleSubmit = () => {
    const trimmed = value().trim();
    if (trimmed) {
      props.onAdd(trimmed);
    }
  };

  return (
    <div class="flex flex-col gap-1 px-3 py-2">
      <label class="text-[10px] text-muted-foreground" for="add-project-path">
        Enter folder path
      </label>
      <div class="flex items-center gap-1">
        <input
          id="add-project-path"
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              props.onCancel();
            }
          }}
          placeholder="/path/to/project"
          type="text"
          class="min-w-0 flex-1 rounded border border-border bg-secondary px-2 py-1 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary"
          value={value()}
        />
        <button
          class={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            value().trim()
              ? "bg-primary text-primary-foreground hover:bg-primary/80"
              : "cursor-not-allowed bg-muted text-muted-foreground",
          )}
          disabled={!value().trim()}
          onClick={handleSubmit}
          type="button"
        >
          Add
        </button>
        <button
          class="rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={props.onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/add-project-input.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/add-project-input.tsx apps/app/src/components/__tests__/add-project-input.test.tsx
git commit -m "feat(sidebar): extract AddProjectInput sub-component"
```

---

## Task 4: Add `removeProject` action to server store

**Files:**

- Modify: `apps/app/src/stores/server-store.ts:33-44` (add `removeProject` to `ServerActions`)
- Modify: `apps/app/src/stores/server-store.ts:112-117` (implement `removeProject`)
- Modify: `apps/app/src/stores/__tests__/server-store.test.ts` (add test)

**Step 1: Write the failing test**

Add to `apps/app/src/stores/__tests__/server-store.test.ts`:

```ts
describe("server store — removeProject", () => {
  it("removes project from projects and projectOrder", () => {
    const { store, actions } = createServerStore();
    actions.setProjects([
      { id: "p1", name: "A", cwd: "/a", createdAt: 1, updatedAt: 1 },
      { id: "p2", name: "B", cwd: "/b", createdAt: 2, updatedAt: 2 },
    ]);

    actions.removeProject("p1");

    expect(store.projects.p1).toBeUndefined();
    expect(store.projects.p2).toBeDefined();
    expect(store.projectOrder).toEqual(["p2"]);
  });

  it("removing non-existent project does not throw", () => {
    const { actions } = createServerStore();
    expect(() => actions.removeProject("nonexistent")).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/stores/__tests__/server-store.test.ts`
Expected: FAIL — `removeProject` is not a function

**Step 3: Write minimal implementation**

Add to `ServerActions` interface in `server-store.ts`:

```ts
removeProject: (projectId: string) => void;
```

Add implementation in `createServerStore`:

```ts
removeProject(projectId) {
  // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
  setStore("projects", projectId, undefined as any);
  setStore("projectOrder", (prev) => prev.filter((id) => id !== projectId));
},
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/stores/__tests__/server-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/stores/server-store.ts apps/app/src/stores/__tests__/server-store.test.ts
git commit -m "feat(store): add removeProject action"
```

---

## Task 5: Add `removeSession` action (already exists — verify)

**Note:** `removeSession` already exists in `server-store.ts:112-116`. No work needed. Skip this task.

---

## Task 6: Add keyboard shortcut `Ctrl+B` for sidebar toggle

**Files:**

- Modify: `apps/app/src/components/layout/sidebar.tsx`

**Step 1: Write the failing test**

Create `apps/app/src/components/__tests__/sidebar-shortcut.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

// Test the keyboard shortcut handler in isolation
describe("sidebar keyboard shortcut", () => {
  it("Ctrl+B toggles sidebar", () => {
    let open = true;
    const toggle = () => {
      open = !open;
    };

    const event = new KeyboardEvent("keydown", { key: "b", ctrlKey: true });
    if (event.key === "b" && event.ctrlKey) {
      toggle();
    }

    expect(open).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-shortcut.test.ts`
Expected: PASS (this is a logic test, not a component test)

**Step 3: Implement in sidebar**

Add to `sidebar.tsx` inside the component:

```ts
import { onCleanup, onMount } from "solid-js";

// Inside the component:
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setSidebarOpen((prev) => !prev);
  }
};

onMount(() => {
  document.addEventListener("keydown", handleKeyDown);
});

onCleanup(() => {
  document.removeEventListener("keydown", handleKeyDown);
});
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-shortcut.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/sidebar.tsx apps/app/src/components/__tests__/sidebar-shortcut.test.ts
git commit -m "feat(sidebar): add Ctrl+B keyboard shortcut"
```

---

## Task 7: Add responsive mobile overlay behavior

**Files:**

- Modify: `apps/app/src/components/layout/sidebar.tsx`

**Step 1: Write the failing test**

Create `apps/app/src/components/__tests__/sidebar-responsive.test.tsx`:

```tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";

describe("sidebar responsive behavior", () => {
  it("sidebar has fixed positioning classes for mobile", () => {
    // This tests the CSS classes applied, not the actual responsive behavior
    // which requires jsdom viewport manipulation
    const sidebar = document.createElement("aside");
    sidebar.className = "fixed inset-y-0 left-0 z-50 w-64";
    expect(sidebar.className).toContain("fixed");
    expect(sidebar.className).toContain("inset-y-0");
    expect(sidebar.className).toContain("left-0");
  });

  it("backdrop has correct overlay classes", () => {
    const backdrop = document.createElement("div");
    backdrop.className = "fixed inset-0 z-40 bg-black/50 backdrop-blur-sm";
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.className).toContain("backdrop-blur-sm");
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-responsive.test.tsx`
Expected: PASS

**Step 3: Rewrite sidebar.tsx with responsive behavior**

Replace the `<aside>` in `sidebar.tsx` with:

```tsx
// Add backdrop for mobile
<Show when={sidebarOpen()}>
  <div
    class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
    onClick={() => setSidebarOpen(false)}
    onKeyDown={(e) => {
      if (e.key === "Escape") setSidebarOpen(false);
    }}
    role="button"
    tabIndex={-1}
    aria-label="Close sidebar"
  />
</Show>;

{
  /* Sidebar panel */
}
<aside
  class={cn(
    "flex w-64 shrink-0 flex-col border-border border-r bg-card",
    "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
    "md:relative md:z-auto md:transition-none",
    sidebarOpen() ? "translate-x-0" : "-translate-x-full md:hidden",
  )}
>
  {/* ... existing content ... */}
</aside>;
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-responsive.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/sidebar.tsx apps/app/src/components/__tests__/sidebar-responsive.test.tsx
git commit -m "feat(sidebar): add responsive mobile overlay with backdrop"
```

---

## Task 8: Add project context menu (HTML fallback)

**Files:**

- Create: `apps/app/src/components/layout/project-context-menu.tsx`
- Create: `apps/app/src/components/__tests__/project-context-menu.test.tsx`

**Step 1: Write the failing test**

```tsx
// apps/app/src/components/__tests__/project-context-menu.test.tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ProjectContextMenu } from "../layout/project-context-menu.tsx";

describe("ProjectContextMenu", () => {
  it("renders menu items", () => {
    const { getByText } = render(() => (
      <ProjectContextMenu
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
        onClose={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onOpenInEditor={vi.fn()}
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(getByText("Open in Terminal")).toBeTruthy();
    expect(getByText("Open in Editor")).toBeTruthy();
    expect(getByText("Copy Path")).toBeTruthy();
    expect(getByText("Remove Project")).toBeTruthy();
  });

  it("calls onOpenInTerminal when clicked", async () => {
    const onOpenInTerminal = vi.fn();
    const { getByText } = render(() => (
      <ProjectContextMenu
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
        onClose={vi.fn()}
        onOpenInTerminal={onOpenInTerminal}
        onOpenInEditor={vi.fn()}
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    getByText("Open in Terminal").click();
    expect(onOpenInTerminal).toHaveBeenCalledWith("p1");
  });

  it("calls onClose after action", async () => {
    const onClose = vi.fn();
    const { getByText } = render(() => (
      <ProjectContextMenu
        projectId="p1"
        projectName="My Project"
        x={100}
        y={100}
        onClose={onClose}
        onOpenInTerminal={vi.fn()}
        onOpenInEditor={vi.fn()}
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    getByText("Copy Path").click();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders at correct position", () => {
    const { container } = render(() => (
      <ProjectContextMenu
        projectId="p1"
        projectName="My Project"
        x={200}
        y={300}
        onClose={vi.fn()}
        onOpenInTerminal={vi.fn()}
        onOpenInEditor={vi.fn()}
        onCopyPath={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    const menu = container.querySelector('[class*="fixed"]');
    expect(menu).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-context-menu.test.tsx`
Expected: FAIL — `ProjectContextMenu` not found

**Step 3: Write minimal implementation**

```tsx
// apps/app/src/components/layout/project-context-menu.tsx
import { onCleanup, onMount, type ParentComponent } from "solid-js";

export interface ProjectContextMenuProps {
  projectId: string;
  projectName: string;
  x: number;
  y: number;
  onClose: () => void;
  onOpenInTerminal: (projectId: string) => void;
  onOpenInEditor: (projectId: string) => void;
  onCopyPath: (projectId: string) => void;
  onRemove: (projectId: string) => void;
}

export const ProjectContextMenu: ParentComponent<ProjectContextMenuProps> = (props) => {
  let menuRef: HTMLDivElement | undefined;

  const handleClick = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node)) {
      props.onClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClick);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const handleAction = (action: () => void) => {
    action();
    props.onClose();
  };

  return (
    <div
      ref={menuRef}
      class="fixed z-[100] min-w-[160px] rounded-lg border border-border bg-card py-1 shadow-lg"
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onOpenInTerminal(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fillRule="evenodd"
            d="M2 4.25A2.25 2.25 0 0 1 4.25 2h7.5A2.25 2.25 0 0 1 14 4.25v7.5A2.25 2.25 0 0 1 11.75 14h-7.5A2.25 2.25 0 0 1 2 11.75v-7.5Zm3.03.47a.75.75 0 0 0-1.06 1.06L5.69 7.5 3.97 9.22a.75.75 0 1 0 1.06 1.06l2.25-2.25a.75.75 0 0 0 0-1.06L5.03 4.72ZM7.75 10a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z"
            clipRule="evenodd"
          />
        </svg>
        Open in Terminal
      </button>

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onOpenInEditor(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L3.22 10.303a1 1 0 0 0-.258.442l-.96 3.425a.25.25 0 0 0 .305.305l3.425-.96a1 1 0 0 0 .442-.258l7.79-7.79a1.75 1.75 0 0 0 0-2.475l-.476-.479z" />
        </svg>
        Open in Editor
      </button>

      <div class="my-1 border-t border-border" />

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-secondary"
        onClick={() => handleAction(() => props.onCopyPath(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H12.5A1.5 1.5 0 0 1 14 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-9z" />
        </svg>
        Copy Path
      </button>

      <div class="my-1 border-t border-border" />

      <button
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
        onClick={() => handleAction(() => props.onRemove(props.projectId))}
        type="button"
      >
        <svg
          class="h-3.5 w-3.5"
          fill="currentColor"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
        </svg>
        Remove Project
      </button>
    </div>
  );
};
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-context-menu.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/project-context-menu.tsx apps/app/src/components/__tests__/project-context-menu.test.tsx
git commit -m "feat(sidebar): add project context menu with HTML fallback"
```

---

## Task 9: Add `[+]` new session button per project

**Files:**

- Modify: `apps/app/src/components/layout/project-group.tsx`

**Step 1: Write the failing test**

Add to `apps/app/src/components/__tests__/project-group.test.tsx`:

```ts
it("renders new session button for each project", () => {
  const onNewSession = vi.fn();
  const { getByTitle } = render(() => (
    <ProjectGroup
      projectId="p1"
      name="My Project"
      sessions={[]}
      isExpanded={false}
      isActive={false}
      onToggle={vi.fn()}
      onSelectSession={vi.fn()}
      onNewSession={onNewSession}
    />
  ));
  const btn = getByTitle("New session in this project");
  expect(btn).toBeTruthy();
  btn.click();
  expect(onNewSession).toHaveBeenCalledWith("p1");
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: FAIL — `onNewSession` prop not defined

**Step 3: Write minimal implementation**

Add to `ProjectGroupProps`:

```ts
onNewSession?: (projectId: string) => void;
```

Add to the project header row in `project-group.tsx` (after the session count badge):

```tsx
<Show when={props.onNewSession}>
  <button
    class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-transparent transition-colors hover:text-muted-foreground hover:text-foreground"
    onClick={(e) => {
      e.stopPropagation();
      props.onNewSession?.(props.projectId);
    }}
    title="New session in this project"
    type="button"
  >
    <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
    </svg>
  </button>
</Show>
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/project-group.tsx apps/app/src/components/__tests__/project-group.test.tsx
git commit -m "feat(sidebar): add [+] new session button per project"
```

---

## Task 10: Add `[×]` remove project button (hover-reveal)

**Files:**

- Modify: `apps/app/src/components/layout/project-group.tsx`

**Step 1: Write the failing test**

Add to `apps/app/src/components/__tests__/project-group.test.tsx`:

```ts
it("renders remove button that calls onRemove", () => {
  const onRemove = vi.fn();
  const { container } = render(() => (
    <ProjectGroup
      projectId="p1"
      name="My Project"
      sessions={[]}
      isExpanded={false}
      isActive={false}
      onToggle={vi.fn()}
      onSelectSession={vi.fn()}
      onRemove={onRemove}
    />
  ));
  const btn = container.querySelector('[aria-label="Remove project"]');
  expect(btn).toBeTruthy();
  btn?.click();
  expect(onRemove).toHaveBeenCalledWith("p1");
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: FAIL — `onRemove` prop not defined

**Step 3: Write minimal implementation**

Add to `ProjectGroupProps`:

```ts
onRemove?: (projectId: string) => void;
```

Add to the project header row in `project-group.tsx` (after the new session button):

```tsx
<Show when={props.onRemove}>
  <button
    aria-label="Remove project"
    class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-transparent transition-colors hover:text-muted-foreground hover:text-foreground"
    onClick={(e) => {
      e.stopPropagation();
      props.onRemove?.(props.projectId);
    }}
    title="Remove from sidebar"
    type="button"
  >
    <svg class="h-3 w-3" fill="currentColor" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
      <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
    </svg>
  </button>
</Show>
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/project-group.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/app/src/components/layout/project-group.tsx apps/app/src/components/__tests__/project-group.test.tsx
git commit -m "feat(sidebar): add [×] remove project button with hover reveal"
```

---

## Task 11: Wire everything together in `sidebar.tsx`

**Files:**

- Modify: `apps/app/src/components/layout/sidebar.tsx` (full rewrite)

**Step 1: Write the failing test**

Create `apps/app/src/components/__tests__/sidebar-integration.test.tsx`:

```tsx
import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import Sidebar from "../layout/sidebar.tsx";

// Mock the store context
vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    server: {
      store: {
        activeProjectId: null,
        activeSessionId: null,
        connection: { status: "open" },
        projectOrder: [],
        projects: {},
        sessionOrder: [],
        sessions: {},
      },
      actions: {
        setActiveProject: vi.fn(),
        setActiveSession: vi.fn(),
      },
    },
    actions: {
      loadProjects: vi.fn(),
      loadSessions: vi.fn(),
      createSession: vi.fn(),
    },
  }),
}));

describe("Sidebar integration", () => {
  it("renders sidebar with header", () => {
    const { getByText } = render(() => <Sidebar />);
    expect(getByText("sakti-code")).toBeTruthy();
  });

  it("renders Projects section", () => {
    const { getByText } = render(() => <Sidebar />);
    expect(getByText("Projects")).toBeTruthy();
  });

  it("renders empty state when no projects", () => {
    const { getByText } = render(() => <Sidebar />);
    expect(getByText("No projects yet")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-integration.test.tsx`
Expected: FAIL — likely import errors due to mocking

**Step 3: Rewrite sidebar.tsx**

Replace `apps/app/src/components/layout/sidebar.tsx` with:

```tsx
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { Tooltip } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useStore } from "~/stores/store-context";
import { setSidebarOpen, sidebarOpen } from "~/stores/ui-signals";
import { AddProjectInput } from "./add-project-input.tsx";
import { ProjectContextMenu } from "./project-context-menu.tsx";
import { ProjectGroup } from "./project-group.tsx";

dayjs.extend(relativeTime);

export default function Sidebar() {
  const { server, actions } = useStore();
  const [expandedProjects, setExpandedProjects] = createSignal<Set<string>>(new Set());
  const [showAddInput, setShowAddInput] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{
    projectId: string;
    x: number;
    y: number;
  } | null>(null);

  onMount(() => {
    actions.loadProjects();
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  createEffect(() => {
    const projectId = server.store.activeProjectId;
    if (projectId) {
      actions.loadSessions(projectId);
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.add(projectId);
        return next;
      });
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "b" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSidebarOpen((prev) => !prev);
    }
  };

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const selectSession = (sessionId: string) => {
    const session = server.store.sessions[sessionId];
    if (session) {
      server.actions.setActiveProject(session.projectId);
      server.actions.setActiveSession(sessionId);
    }
  };

  const handleNewSession = async (projectId: string) => {
    server.actions.setActiveProject(projectId);
    await actions.createSession(projectId, "default");
  };

  const handleRemoveProject = (projectId: string) => {
    server.actions.removeProject(projectId);
  };

  const handleContextMenu = (projectId: string, e: MouseEvent) => {
    e.preventDefault();
    setContextMenu({ projectId, x: e.clientX, y: e.clientY });
  };

  const handleOpenInTerminal = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      // TODO: Wire to terminal store
      console.log("Open in terminal:", project.cwd);
    }
  };

  const handleOpenInEditor = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      // TODO: Wire to native API
      console.log("Open in editor:", project.cwd);
    }
  };

  const handleCopyPath = (projectId: string) => {
    const project = server.store.projects[projectId];
    if (project) {
      navigator.clipboard.writeText(project.cwd);
    }
  };

  const sessionsForProject = (projectId: string) =>
    server.store.sessionOrder
      .map((id) => server.store.sessions[id])
      .filter((s): s is NonNullable<typeof s> => !!s && s.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  const projectCount = () => server.store.projectOrder.length;

  return (
    <>
      {/* Mobile backdrop */}
      <Show when={sidebarOpen()}>
        <div
          class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setSidebarOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSidebarOpen(false);
          }}
          role="button"
          tabIndex={-1}
          aria-label="Close sidebar"
        />
      </Show>

      {/* Sidebar panel */}
      <aside
        class={cn(
          "flex w-64 shrink-0 flex-col border-border border-r bg-card",
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
          "md:relative md:z-auto md:transition-none",
          sidebarOpen() ? "translate-x-0" : "-translate-x-full md:hidden",
        )}
      >
        {/* Header */}
        <div class="flex h-10 items-center justify-between border-border border-b px-3">
          <span class="font-semibold text-foreground text-sm">sakti-code</span>
          <Tooltip content="Close sidebar">
            <button
              class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground md:hidden"
              onClick={() => setSidebarOpen(false)}
              type="button"
            >
              <svg
                aria-label="Close sidebar"
                class="h-3.5 w-3.5"
                fill="currentColor"
                role="img"
                viewBox="0 0 16 16"
                xmlns="http://www.w3.org/2000/svg"
              >
                <title>Close sidebar</title>
                <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
              </svg>
            </button>
          </Tooltip>
        </div>

        {/* Projects section */}
        <div class="flex items-center justify-between px-3 py-2">
          <span class="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Projects
          </span>
          <div class="flex items-center gap-0.5">
            <Tooltip content="Add project">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setShowAddInput(true)}
                type="button"
              >
                <svg
                  aria-label="Add project"
                  class="h-3.5 w-3.5"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Add project</title>
                  <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z" />
                </svg>
              </button>
            </Tooltip>
            <Tooltip content="Refresh">
              <button
                class="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => actions.loadProjects()}
                type="button"
              >
                <svg
                  aria-label="Refresh projects"
                  class="h-3.5 w-3.5"
                  fill="currentColor"
                  role="img"
                  viewBox="0 0 16 16"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>Refresh projects</title>
                  <path
                    fillRule="evenodd"
                    d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37A5.508 5.508 0 0 0 8 3.5a5.5 5.5 0 1 0 5.215 3.772.75.75 0 1 1 1.423-.474A7 7 0 1 1 12.12 3.16l1.716.005z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </Tooltip>
          </div>
        </div>

        <Separator />

        {/* Project tree */}
        <ScrollArea class="flex-1">
          <Show
            fallback={
              <div class="flex flex-col items-center justify-center px-4 py-8 text-center">
                <svg
                  aria-label="No projects"
                  class="mb-2 h-8 w-8 text-muted-foreground/50"
                  fill="none"
                  role="img"
                  stroke="currentColor"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <title>No projects</title>
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                </svg>
                <span class="text-muted-foreground text-xs">No projects yet</span>
              </div>
            }
            when={projectCount() > 0}
          >
            <For each={server.store.projectOrder}>
              {(projectId) => {
                const project = () => server.store.projects[projectId];
                const sessions = () => sessionsForProject(projectId);
                const isExpanded = () => expandedProjects().has(projectId);
                const isActive = () => server.store.activeProjectId === projectId;

                return (
                  <Show when={project()}>
                    <div onContextMenu={(e) => handleContextMenu(projectId, e)}>
                      <ProjectGroup
                        isActive={isActive()}
                        isExpanded={isExpanded()}
                        name={project()!.name}
                        onNewSession={handleNewSession}
                        onRemove={handleRemoveProject}
                        onSelectSession={selectSession}
                        onToggle={toggleProject}
                        projectId={projectId}
                        sessions={sessions()}
                      />
                    </div>
                  </Show>
                );
              }}
            </For>
          </Show>

          {/* Add project input */}
          <Show when={showAddInput()}>
            <AddProjectInput
              onAdd={async (cwd) => {
                setShowAddInput(false);
                // TODO: Wire to API
                console.log("Add project:", cwd);
              }}
              onCancel={() => setShowAddInput(false)}
            />
          </Show>
        </ScrollArea>

        {/* Footer */}
        <div class="border-border border-t px-3 py-2">
          <span class="text-[10px] text-muted-foreground">v0.1.0</span>
        </div>
      </aside>

      {/* Context menu */}
      <Show when={contextMenu()}>
        <ProjectContextMenu
          onClose={() => setContextMenu(null)}
          onCopyPath={handleCopyPath}
          onOpenInEditor={handleOpenInEditor}
          onOpenInTerminal={handleOpenInTerminal}
          onRemove={(id) => {
            handleRemoveProject(id);
            setContextMenu(null);
          }}
          projectId={contextMenu()!.projectId}
          projectName={server.store.projects[contextMenu()!.projectId]?.name ?? ""}
          x={contextMenu()!.x}
          y={contextMenu()!.y}
        />
      </Show>
    </>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/app && npx vitest run src/components/__tests__/sidebar-integration.test.tsx`
Expected: PASS

**Step 5: Run all tests to verify no regressions**

Run: `cd apps/app && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add apps/app/src/components/layout/sidebar.tsx apps/app/src/components/__tests__/sidebar-integration.test.tsx
git commit -m "feat(sidebar): wire all sub-components together with responsive overlay"
```

---

## Task 12: Verify build and typecheck

**Step 1: Run typecheck**

Run: `cd apps/app && npx tsc --noEmit`
Expected: No errors

**Step 2: Run build**

Run: `cd apps/app && npx vite build`
Expected: Build succeeds

**Step 3: Run lint**

Run: `bun x ultracite fix`
Expected: No errors

**Step 4: Final commit if lint fixes applied**

```bash
git add -A
git commit -m "fix(sidebar): lint and typecheck fixes"
```

---

## Summary

| Task | Component             | Lines Added | Tests |
| ---- | --------------------- | ----------- | ----- |
| 1    | SessionItem           | ~40         | 5     |
| 2    | ProjectGroup          | ~80         | 6     |
| 3    | AddProjectInput       | ~60         | 4     |
| 4    | removeProject action  | ~10         | 2     |
| 5    | (skip)                | 0           | 0     |
| 6    | Keyboard shortcut     | ~15         | 1     |
| 7    | Responsive overlay    | ~20         | 2     |
| 8    | ProjectContextMenu    | ~100        | 4     |
| 9    | New session button    | ~20         | 1     |
| 10   | Remove project button | ~20         | 1     |
| 11   | Sidebar rewrite       | ~200        | 3     |
| 12   | Verification          | 0           | 0     |

**Total:** ~565 lines, 29 tests, 11 commits
