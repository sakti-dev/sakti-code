# Chat Input `@` Fetch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `@` chat-input menu reliably receive focus and issue the files query so typed text produces matches instead of an empty menu.

**Architecture:** Keep `ChatInput` responsible for trigger detection and menu state only. Move the focus timing into `ContextMenu`, where the actual command input exists, so the menu can focus itself after mount/open and then drive `onFilesQuery` through the existing debounced resource path.

**Tech Stack:** SolidJS, Vitest, `@solidjs/testing-library`, `vp`, existing Hono client mocks in the desktop test harness.

## Global Constraints

- SolidJS is a hard requirement, not React.
- Package manager/tooling is pnpm; runtime/test entrypoints go through `vp`.
- Tests live in colocated `__tests__/` directories and use Vitest.
- Keep TypeScript strictness, including `exactOptionalPropertyTypes: true`.
- Follow the repo's existing local patterns in `apps/desktop/src/components/chat-input/`.

---

### Task 1: Add a regression test that proves `@` opens a focused search input and reaches the files query

**Files:**

- Create: `apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx`

**Interfaces:**

- Consumes: `ChatInput`, the desktop store mock, and the existing `files.$get` API shape.
- Produces: a failing test that proves `@` opens the menu, focuses the search input, and causes the files search request to fire with the typed query.

- [ ] **Step 1: Write the failing test**

```ts
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";

const mockFilesGet = vi.fn();

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: {
      sendPrompt: vi.fn(),
      replyPermission: vi.fn(),
    },
    sessions: {
      get: () => ({ store: { streaming: { phase: "idle" }, turns: [] } }),
    },
    server: {
      store: {
        sessions: {
          s1: { modelId: "test-model", profileId: null, projectId: "proj1" },
        },
        projects: {
          proj1: {
            id: "proj1",
            name: "P",
            cwd: "/tmp/proj",
            createdAt: 0,
            updatedAt: 0,
          },
        },
      },
    },
    api: {
      api: {
        auth: { $get: async () => ({ ok: false, json: async () => [] }) },
        profiles: { $get: async () => ({ ok: false, json: async () => [] }) },
        projects: {
          ":id": {
            context: {
              $get: async () => ({
                ok: true,
                json: async () => ({
                  commands: [{ name: "commit", description: "d" }],
                  skills: [],
                  agents: [],
                }),
              }),
            },
            files: {
              $get: mockFilesGet,
            },
          },
        },
        models: {
          available: { $get: async () => ({ ok: false, json: async () => [] }), ":provider": { $get: async () => ({ ok: false, json: async () => [] }) } },
          connected: { $get: async () => ({ ok: false, json: async () => [] }) },
        },
      },
    },
  }),
}));

afterEach(() => {
  cleanup();
  mockFilesGet.mockClear();
});

describe("ChatInput @ fetch", () => {
  it("focuses the @ search input and fetches files for typed query", async () => {
    render(() => <ChatInput placeholder="p" sessionId="s1" />);
    const editor = screen.getByRole("textbox") as HTMLElement;

    fireEvent.keyDown(editor, { key: "@" });

    const input = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });

    await userEvent.type(input, "src");

    await waitFor(() => {
      expect(mockFilesGet).toHaveBeenCalledWith({
        param: { id: "proj1" },
        query: { query: "src" },
      });
    });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails for the current bug**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

Expected: the test opens the menu, but the focus assertion fails because the search input is not reliably focused, so typing does not reach the files query path.

- [ ] **Step 3: Keep the test focused on behavior, not implementation**

If the test becomes flaky, keep the assertion on `document.activeElement` and `mockFilesGet` rather than asserting on `queueMicrotask`, `setTimeout`, or DOM query internals.

---

### Task 2: Move focus ownership into the menu and remove the eager DOM query from `ChatInput`

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Modify: `apps/desktop/src/components/chat-input/context-menu.tsx`

**Interfaces:**

- Consumes: `ContextMenu`'s existing `open`, `mode`, and `onFilesQuery` props.
- Produces: the same user-facing menu behavior, but with the search input focused after the menu opens and the query path preserved.

- [ ] **Step 1: Remove the `queueMicrotask` focus handoff from `ChatInput.onTrigger`**

Replace this:

```ts
const onTrigger = ({ char }: { char: ContextMenuMode }) => {
  setMenu(char);
  queueMicrotask(() => {
    const input = document.querySelector("[cmdk-input]") as HTMLInputElement | null;
    input?.focus();
  });
};
```

with this:

```ts
const onTrigger = ({ char }: { char: ContextMenuMode }) => {
  setMenu(char);
};
```

- [ ] **Step 2: Let `ContextMenu` focus its own command input after it opens**

Add a local input ref and an effect in `context-menu.tsx`:

```ts
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";

let inputRef: HTMLInputElement | undefined;

createEffect(() => {
  if (!props.open) {
    return;
  }
  const frame = requestAnimationFrame(() => {
    inputRef?.focus();
  });
  onCleanup(() => cancelAnimationFrame(frame));
});
```

Wire the ref onto the existing `CommandInput`:

```tsx
<CommandInput
  ref={(el) => {
    inputRef = el;
  }}
  onKeyDown={nav.handleKeyDown}
  onValueChange={onQueryChange}
  placeholder={props.mode === "/" ? "Filter…" : "Search files…"}
  value={query()}
/>
```

This keeps the focus timing next to the actual input element that appears in the dialog, which is the point where the current code is racing the DOM.

- [ ] **Step 3: Run the new test and confirm it turns green**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

Expected: the search input receives focus, the typed query reaches `files.$get`, and the mock sees `{ param: { id: "proj1" }, query: { query: "src" } }`.

---

### Task 3: Run the nearby desktop chat-input tests and confirm no regression in `/` behavior

**Files:**

- Verify: `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx`

**Interfaces:**

- Consumes: the existing chat-input wiring tests.
- Produces: proof that the `/` menu still opens and the existing send/insert behavior stays intact.

- [ ] **Step 1: Run the nearby test file**

Run:

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx apps/desktop/src/components/chat-input/__tests__/chat-input-at-fetch.test.tsx
```

- [ ] **Step 2: Verify the package-level gate if the desktop test target passes**

Run:

```bash
vp check
```

Then run:

```bash
vp test
```

Expected: both commands complete cleanly for the touched desktop code.

## Self-Review

- Spec coverage: the plan covers the broken user-visible behavior, the menu focus handoff, the files-query fetch path, and the regression verification.
- Placeholder scan: no "TBD" or deferred implementation notes remain in the plan.
- Type consistency: the added `inputRef` is used in both the `createEffect` and the `CommandInput` `ref`, and the test uses the same `files.$get` request shape as the existing store mock.
