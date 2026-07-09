# Inline Context Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the modal `CommandDialog`-based `@`/`/` context menu with an inline, banner-style list (like `permission-strip`) that filters as the user types in the chip editor, with arrow/enter keyboard navigation.

**Architecture:** Three pieces.

1. `ChipInput` keeps focus and owns the editor mechanics: the trigger char enters the DOM, the live "query" (text after the trigger) is emitted via `onQuery`, nav keys (Arrow/Enter/Esc) are forwarded via `onMenuKeyDown`, and `replaceTokenWithChip(token)` swaps the typed token text for a chip.
2. `InlineContextList` is a pure presentational banner: takes pre-built `rows` + an `activeId`, renders grouped rows, scrolls the active row into view, click picks.
3. `ChatInput` wires them: owns menu mode + query + the `buildRows` memo + the existing `useListNavigation` hook; renders the list where `PermissionStrip` sits today. The old `context-menu.tsx` (CommandDialog) and its test are deleted.

**Tech Stack:** SolidJS, TypeScript, vitest (`vite-plus/test`), Tailwind. Solid conventions: `class`/`for`, `Show`/`For`, `createMemo`/`createSignal`/`createResource`, `exactOptionalPropertyTypes`.

---

## Conventions for this plan

- **Run a single test file** from `apps/desktop`:
  `vp test run src/components/chat-input/__tests__/<file>`
- **Run the whole chat-input suite** from `apps/desktop`:
  `vp test run src/components/chat-input/__tests__/`
- **Format + lint + typecheck** from repo root: `vp check`
- Follow TDD: write the failing test, watch it fail for the _right_ reason, write minimal code, watch it pass, commit. Never write production code before a failing test.
- `exactOptionalPropertyTypes: true` — never pass `undefined`; use conditional spread or omit the key.
- Do not add comments unless asked. Keep `createLogger` instrumentation that already exists.

### A note on jsdom + contenteditable

jsdom does **not** insert text into a `contenteditable` on `fireEvent.keyDown`. The existing `chip-input.test.tsx` works around this by mutating `editor.textContent` and firing `input`. For the new live-query behavior we must exercise the Range-based query logic, so these tests use a small helper that inserts a text node at the current `Selection` (what a real browser does) and then fires `input`. Add this helper to the chip-input test file:

```ts
/** Insert text at the caret (mimics browser typing in a contenteditable). */
function typeText(editor: HTMLElement, text: string) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(document.createTextNode(text));
  }
  fireEvent.input(editor);
}

/** Collapse the caret at the start (or after the last node) of the editor. */
function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true); // to start
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretAtEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false); // to end
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
```

---

## Task 1: `buildRows` pure helper

Extract the row-building + filtering logic currently inside `context-menu.tsx` into a pure, framework-free module so it can be unit-tested in isolation and shared by `ChatInput` (for the nav hook) and `InlineContextList` (for rendering).

**Files:**

- Create: `apps/desktop/src/components/chat-input/context-rows.ts`
- Create: `apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts`

### Step 1: Write the failing test

`apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts`:

```ts
import { describe, expect, it } from "vite-plus/test";
import { buildRows, type CatalogItem, type FileItem } from "../context-rows";

const commands: CatalogItem[] = [{ name: "commit", description: "commit and push" }];
const skills: CatalogItem[] = [{ name: "graphify", description: "build a graph" }];
const files: FileItem[] = [{ path: "src/a.ts" }, { path: "src/b.ts" }];

describe("buildRows (/ mode)", () => {
  it("lists commands then skills with group labels", () => {
    const rows = buildRows({ mode: "/", query: "", commands, skills, files: [] });
    expect(rows.map((r) => r.token)).toEqual(["/commit", "skill:graphify"]);
    expect(rows[0].group).toBe("Commands");
    expect(rows[1].group).toBe("Skills");
    expect(rows[0]).toMatchObject({
      id: "cmd:commit",
      label: "commit",
      description: "commit and push",
    });
  });

  it("filters commands + skills by query over name and description", () => {
    const rows = buildRows({ mode: "/", query: "graph", commands, skills, files: [] });
    expect(rows.map((r) => r.token)).toEqual(["skill:graphify"]);
  });
});

describe("buildRows (@ mode)", () => {
  it("lists files under a Files group", () => {
    const rows = buildRows({ mode: "@", query: "", commands: [], skills: [], files });
    expect(rows.map((r) => r.token)).toEqual(["@src/a.ts", "@src/b.ts"]);
    expect(rows[0].group).toBe("Files");
  });

  it("offers a 'use as path' row when no files match a non-empty query", () => {
    const rows = buildRows({
      mode: "@",
      query: "deep/miss.ts",
      commands: [],
      skills: [],
      files: [],
    });
    expect(rows.map((r) => r.token)).toEqual(["@deep/miss.ts"]);
    expect(rows[0].id).toBe("use-as-path");
  });

  it("does NOT offer 'use as path' when files exist or query is empty", () => {
    expect(
      buildRows({ mode: "@", query: "src", commands: [], skills: [], files }).some(
        (r) => r.id === "use-as-path",
      ),
    ).toBe(false);
    expect(buildRows({ mode: "@", query: "", commands: [], skills: [], files: [] })).toEqual([]);
  });
});
```

### Step 2: Run it to verify it fails

```
vp test run src/components/chat-input/__tests__/context-rows.test.ts
```

Expected: FAIL — `Cannot find module "../context-rows"`.

### Step 3: Implement

`apps/desktop/src/components/chat-input/context-rows.ts`:

```ts
export type ContextMenuMode = "/" | "@";

export interface CatalogItem {
  description?: string;
  name: string;
}

export interface FileItem {
  path: string;
}

export interface Row {
  description?: string;
  group: string;
  id: string;
  label: string;
  token: string;
}

function matches(haystack: string, query: string): boolean {
  if (!query) {
    return true;
  }
  return haystack.toLowerCase().includes(query.toLowerCase());
}

/**
 * Build the flat, ordered list of rows shown in the inline context menu. The
 * same array drives keyboard nav (useListNavigation) and rendering, so arrow
 * order always matches visual order. `/` filters commands+skills client-side;
 * `@` expects server-filtered files and adds a "use as path" fallback when the
 * search comes up empty for a non-empty query.
 */
export function buildRows(opts: {
  mode: ContextMenuMode;
  query: string;
  commands: CatalogItem[];
  skills: CatalogItem[];
  files: FileItem[];
}): Row[] {
  const { mode, query, commands, skills, files } = opts;
  const q = query.trim();

  if (mode === "/") {
    const commandRows: Row[] = commands
      .filter((c) => matches(`${c.name} ${c.description ?? ""}`, q))
      .map((c) => ({
        group: "Commands",
        id: `cmd:${c.name}`,
        label: c.name,
        token: `/${c.name}`,
        ...(c.description !== undefined ? { description: c.description } : {}),
      }));
    const skillRows: Row[] = skills
      .filter((s) => matches(`${s.name} ${s.description ?? ""}`, q))
      .map((s) => ({
        group: "Skills",
        id: `skl:${s.name}`,
        label: s.name,
        token: `skill:${s.name}`,
        ...(s.description !== undefined ? { description: s.description } : {}),
      }));
    return [...commandRows, ...skillRows];
  }

  const fileRows: Row[] = files.map((f) => ({
    group: "Files",
    id: `file:${f.path}`,
    label: f.path,
    token: `@${f.path}`,
  }));

  if (fileRows.length > 0 || q.length === 0) {
    return fileRows;
  }

  return [
    {
      group: "Files",
      id: "use-as-path",
      label: `Use '@${q}' as a path`,
      token: `@${q}`,
    },
    ...fileRows,
  ];
}
```

### Step 4: Run the test, verify it passes

```
vp test run src/components/chat-input/__tests__/context-rows.test.ts
```

Expected: PASS (5 tests).

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-input/context-rows.ts \
        apps/desktop/src/components/chat-input/__tests__/context-rows.test.ts
git commit -m "feat(desktop): add buildRows helper for context-menu rows"
```

---

## Task 2: `InlineContextList` presentational component

A banner-style list rendered above the chat input. Pure: receives rows + activeId + handlers. No keyboard handling of its own (the editor owns the keys); only mouse clicks + active-row scroll.

**Files:**

- Create: `apps/desktop/src/components/chat-input/inline-context-list.tsx`
- Create: `apps/desktop/src/components/chat-input/__tests__/inline-context-list.test.tsx`

### Step 1: Write the failing test

`apps/desktop/src/components/chat-input/__tests__/inline-context-list.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { InlineContextList } from "../inline-context-list";
import type { Row } from "../context-rows";

const rows: Row[] = [
  {
    group: "Commands",
    id: "cmd:commit",
    label: "commit",
    token: "/commit",
    description: "commit and push",
  },
  { group: "Skills", id: "skl:graphify", label: "graphify", token: "skill:graphify" },
  { group: "Files", id: "file:src/a.ts", label: "src/a.ts", token: "@src/a.ts" },
];

afterEach(cleanup);

describe("InlineContextList", () => {
  it("renders group headings and rows in order", () => {
    render(() => <InlineContextList mode="/" rows={rows} activeId="cmd:commit" onPick={vi.fn()} />);
    expect(screen.getByText("Commands")).toBeTruthy();
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.getByText("Files")).toBeTruthy();
    expect(screen.getByText("commit")).toBeTruthy();
    expect(screen.getByText("graphify")).toBeTruthy();
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("marks the active row aria-selected", () => {
    render(() => (
      <InlineContextList mode="/" rows={rows} activeId="skl:graphify" onPick={vi.fn()} />
    ));
    const active = screen.getByText("graphify").closest('button, [role="option"]')!;
    expect(active.getAttribute("aria-selected")).toBe("true");
    const idle = screen.getByText("commit").closest('button, [role="option"]')!;
    expect(idle.getAttribute("aria-selected")).toBe("false");
  });

  it("calls onPick with the token when a row is clicked", () => {
    const onPick = vi.fn();
    render(() => <InlineContextList mode="@" rows={rows} activeId={null} onPick={onPick} />);
    fireEvent.click(screen.getByText("src/a.ts"));
    expect(onPick).toHaveBeenCalledWith("@src/a.ts");
  });

  it("shows an empty state when there are no rows", () => {
    render(() => <InlineContextList mode="/" rows={[]} activeId={null} onPick={vi.fn()} />);
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("scrolls the active row into view when activeId changes", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    try {
      const { rerender } = render(
        (props: { activeId: string | null }) => (
          <InlineContextList mode="/" rows={rows} activeId={props.activeId} onPick={vi.fn()} />
        ),
        { activeId: "cmd:commit" },
      );

      scrollIntoView.mockClear();
      rerender({ activeId: "file:src/a.ts" });
      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});
```

### Step 2: Run it to verify it fails

```
vp test run src/components/chat-input/__tests__/inline-context-list.test.tsx
```

Expected: FAIL — `Cannot find module "../inline-context-list"`.

### Step 3: Implement

`apps/desktop/src/components/chat-input/inline-context-list.tsx`:

```tsx
import { createEffect, For, type JSX, Show } from "solid-js";
import { cn } from "~/lib/utils";
import type { ContextMenuMode, Row } from "./context-rows";

export interface InlineContextListProps {
  activeId: string | null;
  mode: ContextMenuMode;
  onPick: (token: string) => void;
  rows: Row[];
}

/**
 * Inline banner list shown above the chat input when `/` or `@` is active.
 * Presentational: the parent owns the rows (via buildRows) and keyboard nav
 * (via useListNavigation); this component only renders rows, tracks the active
 * one for aria + scroll, and picks on click. Rows render in the order given so
 * arrow order matches visual order. A group heading is emitted whenever the
 * row's group changes.
 */
export function InlineContextList(props: InlineContextListProps): JSX.Element {
  let listRef: HTMLDivElement | undefined;

  // Scroll the active row into view whenever it changes.
  const scrollActive = () => {
    const list = listRef;
    if (!list) {
      return;
    }
    const el = list.querySelector('[data-active="true"]');
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" });
    }
  };

  createEffect(() => {
    props.activeId;
    scrollActive();
  });

  return (
    <div
      aria-live="polite"
      class="-mb-2 max-h-[25rem] overflow-y-auto overflow-x-hidden rounded-t-xl border-primary/30 border-x border-t bg-popover/95 backdrop-blur"
      ref={(el) => {
        listRef = el;
      }}
      role="listbox"
    >
      <Show
        fallback={<div class="px-3 py-2 text-muted-foreground text-xs">No matches</div>}
        when={props.rows.length > 0}
      >
        <For each={props.rows}>
          {(row, i) => (
            <>
              <Show when={i() === 0 || props.rows[i() - 1].group !== row.group}>
                <p class="px-3 pt-2 font-medium text-muted-foreground text-xs">{row.group}</p>
              </Show>
              <button
                aria-selected={props.activeId === row.id ? "true" : "false"}
                class={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                  props.activeId === row.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                data-active={props.activeId === row.id ? "true" : "false"}
                data-token={row.token}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => props.onPick(row.token)}
                role="option"
                type="button"
              >
                <span class="truncate font-medium">{row.label}</span>
                <Show when={row.description}>
                  <span class="truncate text-muted-foreground text-xs">{row.description}</span>
                </Show>
              </button>
            </>
          )}
        </For>
      </Show>
    </div>
  );
}
```

### Step 4: Run the test, verify it passes

```
vp test run src/components/chat-input/__tests__/inline-context-list.test.tsx
```

Expected: PASS (5 tests). If the aria-selected closest-lookup is brittle, assert via `data-active` instead.

### Step 5: Commit

```bash
git add apps/desktop/src/components/chat-input/inline-context-list.tsx \
        apps/desktop/src/components/chat-input/__tests__/inline-context-list.test.tsx
git commit -m "feat(desktop): add InlineContextList presentational banner"
```

---

## Task 3: Rewire `ChipInput` (editor mechanics) + `ChatInput` (wiring) and delete `context-menu.tsx`

These are tightly coupled — `ChipInput`'s API changes (`insertChip` → `replaceTokenWithChip`, new `onQuery` / `onMenuKeyDown` props, trigger char now enters the DOM), and `ChatInput` is the sole consumer. Land them together so the tree stays coherent. Use TDD within the task: write/update the failing tests first, watch them fail, implement, watch pass.

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chip-input.tsx`
- Modify: `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx`
- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Modify: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx`
- Modify: `apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx`
- Delete: `apps/desktop/src/components/chat-input/context-menu.tsx`
- Delete: `apps/desktop/src/components/chat-input/__tests__/context-menu.test.tsx`

### Step 1: Update `chip-input.test.tsx` to the new behaviors (RED)

Replace the contents of `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx` with:

```tsx
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { ChipInput, type ChipInputApi } from "../chip-input";
import { serializeEditor } from "../chip-model";

function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretAtEnd(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function typeText(editor: HTMLElement, text: string) {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.setEndAfter(node);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(document.createTextNode(text));
  }
  fireEvent.input(editor);
}

describe("ChipInput", () => {
  it("emits the typed text via onChange", () => {
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    ed.textContent = "hello";
    fireEvent.input(ed);
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("calls onSubmit on Enter (without shift) when no menu is active", () => {
    const onSubmit = vi.fn();
    render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does NOT submit on Shift+Enter", () => {
    const onSubmit = vi.fn();
    render(() => <ChipInput onChange={() => {}} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the placeholder only when empty", () => {
    render(() => <ChipInput onChange={() => {}} placeholder="Send a message…" />);
    expect(screen.queryByText("Send a message…")).not.toBeNull();
    const ed = screen.getByRole("textbox");
    ed.textContent = "x";
    fireEvent.input(ed);
    expect(screen.queryByText("Send a message…")).toBeNull();
  });

  it("exposes clear() and focus() via registerApi", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "stuff";
    fireEvent.input(ed);
    api?.clear();
    expect(ed.textContent).toBe("");
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("ChipInput triggers + live query", () => {
  it("fires onTrigger for / typed at the editor start and lets the char enter the DOM", () => {
    const onChange = vi.fn();
    const onTrigger = vi.fn();
    const onQuery = vi.fn();
    render(() => (
      <ChipInput
        onChange={onChange}
        onTrigger={onTrigger}
        onQuery={onQuery}
        placeholder="Send a message…"
      />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "/" });
    expect(onChange).toHaveBeenLastCalledWith("/");
    expect(onQuery).toHaveBeenCalledWith("");
    expect(ed.textContent).toBe("/");
    expect(screen.queryByText("Send a message…")).toBeNull();
  });

  it("does NOT fire onTrigger for / typed after other content", () => {
    const onTrigger = vi.fn();
    render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "ab";
    fireEvent.input(ed);
    caretAtEnd(ed);
    fireEvent.keyDown(ed, { key: "/" });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires onTrigger for @ at any position", () => {
    const onTrigger = vi.fn();
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onTrigger={onTrigger} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    ed.textContent = "fix ";
    fireEvent.input(ed);
    caretAtEnd(ed);
    fireEvent.keyDown(ed, { key: "@" });
    expect(onTrigger).toHaveBeenCalledWith({ char: "@" });
    expect(ed.textContent).toContain("@");
  });

  it("emits the live query as the user types after the trigger", () => {
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    onQuery.mockClear();
    typeText(ed, "pkg");
    expect(onQuery).toHaveBeenLastCalledWith("pkg");
  });

  it("closes the token (onQuery null) when a space follows the trigger and leaves the text", () => {
    const onQuery = vi.fn();
    render(() => <ChipInput onChange={() => {}} onQuery={onQuery} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    onQuery.mockClear();
    typeText(ed, " ");
    expect(onQuery).toHaveBeenLastCalledWith(null);
    expect(ed.textContent).toContain("@");
  });

  it("forwards Arrow/Enter/Escape to onMenuKeyDown and does NOT submit while a token is active", () => {
    const onSubmit = vi.fn();
    const onMenuKeyDown = vi.fn();
    render(() => (
      <ChipInput
        onChange={() => {}}
        onSubmit={onSubmit}
        onQuery={vi.fn()}
        onMenuKeyDown={onMenuKeyDown}
      />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      onMenuKeyDown.mockClear();
      onSubmit.mockClear();
      fireEvent.keyDown(ed, { key });
      expect(onMenuKeyDown).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    }
  });

  it("does not swallow Tab while a token is active", () => {
    const onMenuKeyDown = vi.fn();
    render(() => <ChipInput onChange={() => {}} onMenuKeyDown={onMenuKeyDown} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    ed.dispatchEvent(event);
    expect(onMenuKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("replaceTokenWithChip swaps the typed token text for an atomic chip", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => (
      <ChipInput onChange={onChange} registerApi={(a) => (api = a)} onQuery={vi.fn()} />
    ));
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "@" });
    typeText(ed, "pk");
    api?.replaceTokenWithChip("@src/a.ts");
    expect(ed.querySelector('.chip[data-token="@src/a.ts"]')).toBeTruthy();
    expect(serializeEditor(ed)).toBe("@src/a.ts ");
    // The typed "@pk" was replaced, not left behind.
    expect(ed.textContent).not.toMatch(/pk/);
  });

  it("replaceTokenWithChip falls back to appending when no token is active", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />);
    const ed = screen.getByRole("textbox");
    ed.textContent = "fix ";
    fireEvent.input(ed);
    api?.replaceTokenWithChip("@src/a.ts");
    expect(serializeEditor(ed)).toBe("fix @src/a.ts ");
    expect(onChange).toHaveBeenLastCalledWith("fix @src/a.ts ");
  });
});
```

### Step 2: Run it to verify it fails

```
vp test run src/components/chat-input/__tests__/chip-input.test.tsx
```

Expected: FAIL — no `onQuery`/`onMenuKeyDown` props, no `replaceTokenWithChip`, and the trigger no longer matches the old "prevents the char from entering the DOM" expectation.

### Step 3: Rewrite `chip-input.tsx`

`apps/desktop/src/components/chat-input/chip-input.tsx`:

```tsx
import { createSignal, type JSX, onMount, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { createChipElement, isAtEditorStart, serializeEditor } from "./chip-model";

export interface ChipTrigger {
  char: "/" | "@";
}

export interface ChipInputApi {
  clear: () => void;
  focus: () => void;
  replaceTokenWithChip: (token: string) => void;
}

export interface ChipInputProps {
  class?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onTrigger?: (t: ChipTrigger) => void;
  /** Live query text after a trigger char; null closes the active token. */
  onQuery?: (query: string | null) => void;
  /** Forwards ArrowUp/ArrowDown/Enter/Escape while a token is active. */
  onMenuKeyDown?: (e: KeyboardEvent) => void;
  placeholder?: string;
  registerApi?: (api: ChipInputApi) => void;
}

/** Snapshot the current selection as a Range, or null when unavailable. */
function saveCaret(): Range | null {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    return sel.getRangeAt(0).cloneRange();
  }
  return null;
}

const MENU_KEYS = new Set(["ArrowDown", "ArrowUp", "Enter", "Escape"]);

export function ChipInput(props: ChipInputProps): JSX.Element {
  let editorRef: HTMLDivElement | undefined;
  const [empty, setEmpty] = createSignal(true);
  // IME composition guard — suppress key handling mid-composition.
  let composing = false;
  // Collapsed Range recorded just BEFORE the trigger char is inserted. The
  // live query is the text between this anchor and the caret; replaceTokenWith
  // Chip deletes that span and drops the chip in its place.
  let tokenAnchor: Range | null = null;

  const emit = () => {
    if (!editorRef) {
      return;
    }
    const text = serializeEditor(editorRef);
    setEmpty(text.length === 0 && editorRef.childNodes.length === 0);
    props.onChange(text);
    computeQuery();
  };

  // Derive the live query from tokenAnchor → caret. Closes (onQuery null) when
  // the token contains whitespace or the trigger char was deleted.
  const computeQuery = () => {
    if (!editorRef || !tokenAnchor) {
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      return;
    }
    const caret = sel.getRangeAt(0);
    const span = tokenAnchor.cloneRange();
    try {
      span.setEnd(caret.startContainer, caret.startOffset);
    } catch {
      return;
    }
    const text = span.toString();
    if (text.length === 0) {
      // Caret moved to/before the anchor — trigger char deleted.
      endToken();
      return;
    }
    const query = text.slice(1); // drop the trigger char itself
    if (/\s/.test(query)) {
      endToken();
      return;
    }
    props.onQuery?.(query);
  };

  const endToken = () => {
    tokenAnchor = null;
    props.onQuery?.(null);
  };

  /** Insert the trigger char at the caret and record the token anchor. */
  const beginToken = (char: "/" | "@") => {
    tokenAnchor = saveCaret();
    insertTextAtCaret(char);
    props.onTrigger?.({ char });
    // Programmatic contenteditable mutations do not fire `input`; explicitly
    // sync parent value, placeholder state, and live query.
    emit();
  };

  const insertTextAtCaret = (text: string) => {
    const ed = editorRef;
    if (!ed) {
      return;
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // No selection (e.g. jsdom without a set caret): append at the end.
      ed.appendChild(document.createTextNode(text));
    }
  };

  const replaceTokenWithChip = (token: string) => {
    const ed = editorRef;
    if (!ed) {
      return;
    }
    const chip = createChipElement(token);
    const spacer = document.createTextNode(" ");
    const anchor = tokenAnchor;
    tokenAnchor = null;
    if (anchor) {
      // Replace [anchor, caret] with the chip + trailing space.
      const sel = window.getSelection();
      const range = anchor.cloneRange();
      if (sel && sel.rangeCount > 0) {
        range.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
      }
      try {
        range.deleteContents();
        range.insertNode(chip);
      } catch {
        ed.appendChild(chip);
      }
      chip.after(spacer);
    } else {
      ed.appendChild(chip);
      ed.appendChild(spacer);
    }
    const text = serializeEditor(ed);
    setEmpty(false);
    props.onChange(text);
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel) {
        return;
      }
      const after = document.createRange();
      after.setStartAfter(spacer);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
      ed.focus();
    });
  };

  const api: ChipInputApi = {
    clear: () => {
      if (editorRef) {
        editorRef.textContent = "";
        tokenAnchor = null;
        emit();
      }
    },
    focus: () => editorRef?.focus(),
    replaceTokenWithChip,
  };

  onMount(() => {
    props.registerApi?.(api);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (composing) {
      return;
    }
    // While a token menu is active, navigation keys go to the menu, not the editor.
    if (tokenAnchor && MENU_KEYS.has(e.key)) {
      e.preventDefault();
      props.onMenuKeyDown?.(e);
      if (e.key === "Escape") {
        endToken();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      props.onSubmit?.();
      return;
    }
    // Trigger detection: "/" only at the editor start, "@" anywhere. The char
    // is inserted by us (not the browser) so we can record the token anchor.
    if (e.key === "/" && editorRef && isAtEditorStart(editorRef)) {
      e.preventDefault();
      beginToken("/");
    } else if (e.key === "@") {
      e.preventDefault();
      beginToken("@");
    }
    // Shift+Enter falls through → default contenteditable newline (pre-wrap renders \n).
  };

  return (
    <div class="relative">
      <Show when={empty() && props.placeholder}>
        <div class="pointer-events-none absolute inset-0 px-1 py-2 text-muted-foreground/60">
          {props.placeholder}
        </div>
      </Show>
      {/* biome-ignore lint/a11y/useSemanticElements: contenteditable host holds inline chip spans; <textarea> cannot */}
      <div
        aria-multiline="true"
        class={cn(
          "scrollbar-default w-full resize-none bg-transparent px-1 py-2 outline-none",
          "max-h-[200px] min-h-6 overflow-y-auto whitespace-pre-wrap break-words",
          "text-foreground",
          props.class,
        )}
        contenteditable={props.disabled ? "false" : "true"}
        data-component="chip-input"
        onBlur={() => endToken()}
        onCompositionEnd={() => {
          composing = false;
          emit();
        }}
        onCompositionStart={() => {
          composing = true;
        }}
        onInput={emit}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          // Force plain-text paste (strip HTML, keep text + newlines).
          e.preventDefault();
          const text = e.clipboardData?.getData("text/plain") ?? "";
          document.execCommand("insertText", false, text);
        }}
        ref={(el: HTMLDivElement) => {
          editorRef = el;
        }}
        role="textbox"
        tabIndex={0}
      />
    </div>
  );
}
```

### Step 4: Run `chip-input.test.tsx`, verify GREEN

```
vp test run src/components/chat-input/__tests__/chip-input.test.tsx
```

Expected: PASS. Fix the Range math until all tests pass. If `computeQuery` misfires in a case, adjust `span.toString()` handling — the tests pin the exact contract.

### Step 5: Rewire `ChatInput` to use the new APIs + `InlineContextList`

Modify `apps/desktop/src/components/chat-input/chat-input.tsx`:

- Replace the `ContextMenu` import with `InlineContextList` and `buildRows`, and import `useListNavigation`:

```tsx
import { InlineContextList } from "./inline-context-list";
import { buildRows, type ContextMenuMode } from "./context-rows";
import { useListNavigation } from "./use-list-navigation.ts";
```

- Remove the `ContextMenuMode` import from `./context-menu`.
- Add the query signal and the rows + nav memos. Replace the existing `onTrigger`/`closeMenu`/files-fetch block. Concretely, after the `files` resource, add:

```tsx
const [tokenQuery, setTokenQuery] = createSignal("");

const onTrigger = ({ char }: { char: ContextMenuMode }) => {
  setTokenQuery("");
  clearTimeout(filesDebounce);
  if (char === "@") {
    setFilesQuery("");
  }
  setMenu(char);
};

// ChipInput reports the live query (null closes the token menu).
const onQuery = (q: string | null) => {
  if (q === null) {
    closeMenu();
    return;
  }
  setTokenQuery(q);
  if (menu() === "@") {
    onFilesQuery(q);
  }
};
```

- Change the `files` resource source so `@` fetches even for an empty query (list everything), and only while the `@` menu is open:

```tsx
const [files] = createResource(
  () => (menu() === "@" ? { pid: projectId(), q: filesQuery() } : null),
  async (src) => {
    if (!src || !src.pid) {
      return [];
    }
    const res = await api.api.projects[":id"].files.$get({
      param: { id: src.pid },
      query: { query: src.q },
    });
    if (!res.ok) {
      return [];
    }
    const body = await res.json();
    return body.files as { path: string }[];
  },
);
```

(Remove the old `if (!pid) return []` fetcher that keyed off the falsy empty-string `filesQuery`.)

- Build the rows and the nav hook:

```tsx
const rows = createMemo(() =>
  buildRows({
    mode: menu() ?? "/",
    query: tokenQuery(),
    commands: catalog()?.commands ?? [],
    skills: catalog()?.skills ?? [],
    files: files() ?? [],
  }),
);

const pick = (token: string) => {
  chipApi?.replaceTokenWithChip(token);
  closeMenu();
};

const closeMenu = () => {
  setMenu(null);
  setTokenQuery("");
  clearTimeout(filesDebounce);
  setFilesQuery("");
  queueMicrotask(() => chipApi?.focus());
};

const nav = useListNavigation(rows, {
  onPick: (row) => pick(row.token),
  onClose: () => closeMenu(),
});
```

(`pick` and `closeMenu` must be defined before `nav`; they are `const` function expressions, not hoisted function declarations.)

- Pass the new props to `ChipInput`:

```tsx
<ChipInput
  disabled={props.disabled}
  onChange={setValue}
  onSubmit={send}
  onTrigger={onTrigger}
  onQuery={onQuery}
  onMenuKeyDown={(e) => nav.handleKeyDown(e)}
  placeholder={props.placeholder ?? "Send a message…"}
  registerApi={(a) => (chipApi = a)}
/>
```

- Render the inline list where the strips live. Add this `Show` immediately after the `PermissionStrip` `Show` and before the rounded input box `div`:

```tsx
<Show when={menu()}>
  <InlineContextList
    activeId={rows()[nav.activeIndex()]?.id ?? null}
    mode={menu()!}
    onPick={(token) => pick(token)}
    rows={rows()}
  />
</Show>
```

- Delete the old `<ContextMenu … />` block at the bottom of the returned JSX.

### Step 6: Update `chat-input.test.tsx` (RED → GREEN)

These tests currently stub `../context-menu` and assert a "Commands & Skills" title. The new list is jsdom-safe (no modal), so drop the stub and assert the real rows. Replace the file body — keep the store mock, change the `vi.mock("../context-menu", …)` to a mock of `../inline-context-list` is **not** needed; instead remove the stub entirely. Update the menu tests:

- Remove the `vi.mock("../context-menu", …)` block and the `ContextMenuMode` import.
- Change expectations:
  - "opens the / menu" → after `fireEvent.keyDown(editor, { key: "/" })` with caret at start, `await screen.findByText("commit")` is present, and a group heading "Commands" is present.
  - "inserts the picked token as a chip (/ mode)": type `/` at start (caretAtStart helper), pick by clicking the "commit" row, assert `.chip[data-token="/commit"]` exists and `serializeEditor(editor)` becomes `/commit ` (the typed `/` was replaced). Then Enter sends `/commit`.
  - "picks the active / row with Enter": type `/` at start, wait for "commit", press Enter while the menu is active, assert `.chip[data-token="/commit"]` exists and Enter again sends `/commit`. This covers `ChatInput` wiring from `ChipInput.onMenuKeyDown` → `useListNavigation` → `pick`.
  - "moves active row with arrows before Enter": provide at least two commands in the store mock (`commit`, `status`), type `/`, press ArrowDown then Enter, and assert the selected chip is `/status`.
  - "@ menu": `typeInto(editor, "see ")`, caretAtEnd, `fireEvent.keyDown(editor, { key: "@" })`, `await screen.findByText("src/a.ts")`.
  - "does not open a menu for / typed mid-text": type "hi ", caretAtEnd, keyDown "/", `screen.queryByText("Commands")` is null.

Add the `caretAtStart`/`caretAtEnd`/`typeInto` helpers (from the Conventions section) to this test file too. The existing `typeInto` (textContent + input) stays for non-caret cases.

Run:

```
vp test run src/components/chat-input/__tests__/chat-input.test.tsx
```

Iterate until GREEN.

### Step 7: Update `chat-input-at-fetch.test.tsx` (RED → GREEN)

Typing now happens in the editor (no `combobox`). Replace the test body to type into the editor and assert the file fetch fires for the active project:

```tsx
describe("ChatInput @ fetch", () => {
  it("fetches files for the @ query before a session exists (onboarding draft)", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    // Open the @ menu (char enters the editor at the caret).
    fireEvent.keyDown(editor, { key: "@" });
    typeText(editor, "src");

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });
  });

  it("lists files even for an empty @ query", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;
    fireEvent.keyDown(editor, { key: "@" });
    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "" },
      });
    });
  });

  it("resets the @ file query when reopening the menu", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    fireEvent.keyDown(editor, { key: "@" });
    typeText(editor, "src");
    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });

    fireEvent.keyDown(editor, { key: "Escape" });
    mockFilesGet.mockClear();
    fireEvent.keyDown(editor, { key: "@" });

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "" },
      });
    });
  });
});
```

Add the `typeText` helper to this file. Keep the `activeProjectId: "proj1"` in the store mock.

Run:

```
vp test run src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

Iterate until GREEN.

### Step 8: Delete `context-menu.tsx` and its test

```bash
git rm apps/desktop/src/components/chat-input/context-menu.tsx \
       apps/desktop/src/components/chat-input/__tests__/context-menu.test.tsx
```

### Step 9: Run the full chat-input suite + typecheck

```
vp test run src/components/chat-input/__tests__/
vp check
```

Expected: all green, 0 diagnostics. If `ui/command.tsx` is now unused elsewhere, leave it (it is a generic UI primitive; do not delete without a usage check — run a grep for `from "~/components/ui/command"` and only remove if zero references).

### Step 10: Commit

```bash
git add -A
git commit -m "refactor(desktop): inline @// context menu, replace CommandDialog"
```

---

## Task 4: Manual verification checklist

Before declaring done, verify in the running app (`vp run desktop#dev`):

- [ ] Typing `/` at the start of an empty editor opens the command list above the box; `/` is visible in the editor.
- [ ] Typing `comm` filters the list live; arrow keys move the highlight; Enter picks `/commit` and the typed `/comm` is replaced by the chip.
- [ ] Typing `/` mid-sentence does **not** open the list.
- [ ] Typing `@` opens the file list (even with nothing after it → lists top files); `@pkg` filters; `@package.json` narrows.
- [ ] Typing `@ ` (space) closes the list and leaves `@ ` as literal text.
- [ ] Escape closes the list and keeps the text; the editor keeps focus.
- [ ] Clicking a row picks it without losing the chip (no focus race).
- [ ] With >10 matches the list scrolls internally; the active row stays visible.
- [ ] Permission/retry strips still render correctly above the input when active.

Capture any defects as failing tests first (TDD), then fix.
