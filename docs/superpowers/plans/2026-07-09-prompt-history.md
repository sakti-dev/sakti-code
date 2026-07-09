# Prompt History (ArrowUp/Down) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ArrowUp/ArrowDown in the chat input cycles through the user's previously-sent prompts, scoped per-project and persisted across sessions.

**Architecture:** No new schema. A server lib queries existing `session_entries` (kind="message", role=user) joined to `sessions` by `projectId`, deduped newest-first. A pure desktop cursor state-machine (`index` + `draft`) drives navigation; `ChipInput` decides when ArrowUp/Down is a history event (caret at editor start/end, no token menu) and calls back; `ChatInput` owns the resource + cursor + editor injection via a new `ChipInputApi.setText`.

**Tech Stack:** Hono + Drizzle (`@sakti-code/db`), SolidJS, vitest (`vite-plus/test`).

**CPU constraint:** Run each test file ONCE — capture output to `/tmp/opencode/*.log` then `rg` it. Do not rerun repeatedly.

**Do NOT commit** unless explicitly asked (repo rule). The per-task commit steps below are skipped.

---

### Task 1: Server lib `getProjectPromptHistory`

**Files:**

- Create: `apps/server/src/lib/prompt-history.ts`
- Test: `apps/server/src/lib/__tests__/prompt-history.test.ts`

**Step 1: Write the failing test**

`apps/server/src/lib/__tests__/prompt-history.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { initDatabase, ProjectRepo, SessionRepo, sessionEntries } from "@sakti-code/db";
import { getProjectPromptHistory } from "../prompt-history.ts";

function userEntry(id: string, text: string, createdAt: number) {
  return {
    id,
    sessionId: "" as string,
    parentId: null,
    sequence: 0,
    kind: "message",
    content: JSON.stringify({
      id,
      parentId: null,
      timestamp: new Date(createdAt).toISOString(),
      type: "message",
      message: { role: "user", content: text, timestamp: createdAt },
    }),
    timestamp: new Date(createdAt).toISOString(),
    createdAt,
    turnId: null,
    isTurnSummary: false,
  };
}

describe("getProjectPromptHistory", () => {
  let tmpDir: string;
  let rawDb: DatabaseSync;
  let db: Awaited<ReturnType<typeof initDatabase>>;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "ph-XXXXXX"));
    rawDb = new DatabaseSync(join(tmpDir, "test.db"));
    db = await initDatabase(rawDb);
    const projects = new ProjectRepo(db);
    const sessions = new SessionRepo(db);
    projectA = (await projects.create("A", "/tmp/a")).id;
    projectB = (await projects.create("B", "/tmp/b")).id;
    const sA = (await sessions.create(projectA)).id;
    const sB = (await sessions.create(projectB)).id;

    const insert = (sessionId: string, seq: number, row: ReturnType<typeof userEntry>) =>
      db
        .insert(sessionEntries)
        .values({ ...row, sessionId, sequence: seq })
        .run();

    insert(sA, 0, userEntry("a1", "hello", 1000));
    insert(sA, 1, userEntry("a2", "world", 2000));
    insert(sA, 2, userEntry("a3", "hello", 3000)); // dup of a1 — newest kept, deduped
    insert(sA, 3, userEntry("a4", "   ", 4000)); // whitespace — dropped
    insert(sB, 0, userEntry("b1", "other-project", 1500));
  });

  afterAll(() => {
    rawDb.close?.();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns only the project's user prompts, deduped, newest-first", () => {
    const prompts = getProjectPromptHistory(db, projectA, 50);
    expect(prompts).toEqual(["hello", "world"]);
  });

  it("scopes to the given project", () => {
    expect(getProjectPromptHistory(db, projectB, 50)).toEqual(["other-project"]);
  });

  it("respects the limit", () => {
    expect(getProjectPromptHistory(db, projectA, 1)).toEqual(["hello"]);
  });
});
```

**Step 2: Run — expect FAIL** (module missing)

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/prompt-history.test.ts > /tmp/opencode/ph1.log 2>&1; echo $?; rg "Cannot find|FAIL|Tests " /tmp/opencode/ph1.log | head
```

**Step 3: Implement** `apps/server/src/lib/prompt-history.ts`:

```ts
import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDB } from "@sakti-code/db";
import { sessionEntries, sessions } from "@sakti-code/db";
import type { AgentMessage } from "@sakti-code/agent";

function extractUserText(message: AgentMessage): string {
  if (!("content" in message)) {
    return "";
  }
  const { content } = message;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: "text"; text: string } =>
          c !== null && typeof c === "object" && "type" in c && c.type === "text",
      )
      .map((c) => c.text)
      .join("");
  }
  return "";
}

interface MessageLike {
  type: string;
  message?: AgentMessage;
}

export function getProjectPromptHistory(db: DrizzleDB, projectId: string, limit: number): string[] {
  const rows = db
    .select({ content: sessionEntries.content })
    .from(sessionEntries)
    .innerJoin(sessions, eq(sessions.id, sessionEntries.sessionId))
    .where(and(eq(sessions.projectId, projectId), eq(sessionEntries.kind, "message")))
    .orderBy(desc(sessionEntries.createdAt))
    .limit(limit)
    .all();

  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const row of rows) {
    let entry: MessageLike;
    try {
      entry = JSON.parse(row.content) as MessageLike;
    } catch {
      continue;
    }
    if (entry.type !== "message") {
      continue;
    }
    const msg = entry.message;
    if (!msg || msg.role !== "user") {
      continue;
    }
    const text = extractUserText(msg).trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    prompts.push(text);
  }
  return prompts;
}
```

**Step 4: Run — expect PASS**

```bash
vp run '@sakti-code/server#test' -- apps/server/src/lib/__tests__/prompt-history.test.ts > /tmp/opencode/ph1.log 2>&1; echo $?; rg "Tests " /tmp/opencode/ph1.log | tail -2
```

---

### Task 2: Server route + composition

**Files:**

- Create: `apps/server/src/routes/projects/prompt-history.ts`
- Modify: `apps/server/src/app.ts` (import + `.route`)
- Test: `apps/server/src/__tests__/prompt-history.test.ts`

**Step 1: Write the failing route test** (mirrors `search-files.test.ts`'s `makeApp` setup):

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { sessionEntries } from "@sakti-code/db";
import { promptHistoryRoutes } from "../routes/projects/prompt-history.ts";
import { makeApp } from "./helpers.ts";

describe("prompt history routes", () => {
  let tmpDir: string;
  let app: Awaited<ReturnType<typeof makeApp>>["app"];
  let ctx: Awaited<ReturnType<typeof makeApp>>["ctx"];
  let projectA: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(import.meta.dirname!, "phr-XXXXXX"));
    const built = await makeApp([promptHistoryRoutes]);
    app = built.app;
    ctx = built.ctx;
    projectA = (await ctx.repos.projects.create("A", "/tmp/a")).id;
    const sA = (await ctx.repos.sessions.create(projectA)).id;
    const mk = (id: string, text: string, createdAt: number) => ({
      id,
      sessionId: sA,
      parentId: null,
      sequence: 0,
      kind: "message",
      timestamp: new Date(createdAt).toISOString(),
      createdAt,
      turnId: null,
      isTurnSummary: false,
      content: JSON.stringify({
        id,
        parentId: null,
        timestamp: new Date(createdAt).toISOString(),
        type: "message",
        message: { role: "user", content: text, timestamp: createdAt },
      }),
    });
    ctx.db
      .insert(sessionEntries)
      .values(mk("a1", "alpha", 1000))
      .run();
    ctx.db
      .insert(sessionEntries)
      .values(mk("a2", "beta", 2000))
      .run();
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("GET /api/projects/:id/prompt-history returns deduped newest-first prompts", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectA}/prompt-history`),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prompts).toEqual(["beta", "alpha"]);
  });

  it("respects ?limit", async () => {
    const res = await app.request(
      new Request(`http://localhost/api/projects/${projectA}/prompt-history?limit=1`),
    );
    expect((await res.json()).prompts).toEqual(["beta"]);
  });

  it("unknown project returns 404", async () => {
    const res = await app.request(new Request("http://localhost/api/projects/nope/prompt-history"));
    expect(res.status).toBe(404);
  });
});
```

> If `makeApp`'s signature differs (it may not accept a routes array), adapt to match `helpers.ts` exactly. Read `apps/server/src/__tests__/helpers.ts` first.

**Step 2: Run — expect FAIL**

```bash
vp run '@sakti-code/server#test' -- apps/server/src/__tests__/prompt-history.test.ts > /tmp/opencode/ph2.log 2>&1; echo $?; rg "Cannot find|FAIL|Tests " /tmp/opencode/ph2.log | head
```

**Step 3: Implement route** `apps/server/src/routes/projects/prompt-history.ts`:

```ts
import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import { getCtx } from "../../context.ts";
import { getProjectPromptHistory } from "../../lib/prompt-history.ts";

export const promptHistoryRoutes = new Hono()
  .basePath("/projects")
  .get(
    "/:id/prompt-history",
    tbValidator("query", Type.Object({ limit: Type.Optional(Type.String()) })),
    async (c) => {
      const ctx = getCtx(c);
      const project = ctx.repos.projects.findById(c.req.param("id"));
      if (!project) {
        return c.json({ error: "Not found" }, 404);
      }
      const rawLimit = c.req.query("limit");
      const parsed = rawLimit === undefined ? undefined : Number(rawLimit);
      const limit = Math.min(Math.max(Number.isFinite(parsed) ? parsed! : 50, 1), 100);
      const prompts = getProjectPromptHistory(ctx.db, project.id, limit);
      return c.json({ prompts });
    },
  );

export type PromptHistoryRoutes = typeof promptHistoryRoutes;
```

**Step 4: Compose in `apps/server/src/app.ts`**

Add import alongside `searchFilesRoutes`:

```ts
import { promptHistoryRoutes } from "./routes/projects/prompt-history.ts";
```

Add to the `.route(...)` chain (next to `searchFilesRoutes`):

```ts
.route("/", promptHistoryRoutes)
```

**Step 5: Run — expect PASS**

```bash
vp run '@sakti-code/server#test' -- apps/server/src/__tests__/prompt-history.test.ts > /tmp/opencode/ph2.log 2>&1; echo $?; rg "Tests " /tmp/opencode/ph2.log | tail -2
```

---

### Task 3: Desktop cursor state machine

**Files:**

- Create: `apps/desktop/src/components/chat-input/prompt-history.ts`
- Test: `apps/desktop/src/components/chat-input/__tests__/prompt-history.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vite-plus/test";
import {
  historyUp,
  historyDown,
  historyCurrent,
  initialHistoryNav,
  type HistoryNavState,
} from "../prompt-history";

const s = (index: number, draft: string): HistoryNavState => ({ index, draft });

describe("prompt history nav", () => {
  it("up from null saves the draft and jumps to newest (index 0)", () => {
    const next = historyUp(initialHistoryNav, ["a", "b"], "draft!");
    expect(next).toEqual(s(0, "draft!"));
    expect(historyCurrent(next, ["a", "b"])).toBe("a");
  });

  it("repeated up moves older and clamps at the oldest", () => {
    let st = historyUp(initialHistoryNav, ["a", "b", "c"], "d");
    st = historyUp(st, ["a", "b", "c"], "d");
    expect(historyCurrent(st, ["a", "b", "c"])).toBe("b");
    st = historyUp(st, ["a", "b", "c"], "d");
    st = historyUp(st, ["a", "b", "c"], "d"); // clamp
    expect(historyCurrent(st, ["a", "b", "c"])).toBe("c");
  });

  it("down moves newer and below 0 restores the draft", () => {
    let st = historyUp(initialHistoryNav, ["a", "b"], "my draft");
    st = historyUp(st, ["a", "b"], "my draft"); // index 1
    st = historyDown(st); // index 0
    expect(historyCurrent(st, ["a", "b"])).toBe("a");
    st = historyDown(st); // -> null, restore draft
    expect(st.index).toBe(-1);
    expect(st.draft).toBe("my draft");
  });

  it("up with empty list is a no-op", () => {
    expect(historyUp(initialHistoryNav, [], "x")).toEqual(initialHistoryNav);
  });

  it("down when not navigating is a no-op", () => {
    expect(historyDown(initialHistoryNav)).toEqual(initialHistoryNav);
  });
});
```

**Step 2: Run — expect FAIL**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/prompt-history.test.ts > /tmp/opencode/ph3.log 2>&1; echo $?; rg "Cannot find|FAIL|Tests " /tmp/opencode/ph3.log | head
```

**Step 3: Implement** `apps/desktop/src/components/chat-input/prompt-history.ts`:

```ts
export interface HistoryNavState {
  /** -1 = not navigating (live draft). */
  index: number;
  /** Text saved when navigation began; restored on down-past-newest. */
  draft: string;
}

export const initialHistoryNav: HistoryNavState = { index: -1, draft: "" };

export function historyUp(state: HistoryNavState, list: string[], draft: string): HistoryNavState {
  if (list.length === 0) {
    return state;
  }
  if (state.index === -1) {
    return { index: 0, draft };
  }
  return { ...state, index: Math.min(state.index + 1, list.length - 1) };
}

export function historyDown(state: HistoryNavState): HistoryNavState {
  if (state.index === -1) {
    return state;
  }
  const next = state.index - 1;
  if (next < 0) {
    return { index: -1, draft: state.draft };
  }
  return { ...state, index: next };
}

export function historyCurrent(state: HistoryNavState, list: string[]): string | null {
  if (state.index === -1) {
    return null;
  }
  return list[state.index] ?? null;
}
```

**Step 4: Run — expect PASS**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/prompt-history.test.ts > /tmp/opencode/ph3.log 2>&1; echo $?; rg "Tests " /tmp/opencode/ph3.log | tail -2
```

---

### Task 4: ChipInput — caret-end helper, history keydown, `setText` API

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chip-model.ts` (add `isPointAtEditorEnd` + `isAtEditorEnd`)
- Modify: `apps/desktop/src/components/chat-input/chip-input.tsx` (keydown + API + prop)
- Test: `apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx` (append cases)

**Step 1: Write failing tests** (append to existing `describe("ChipInput", ...)`):

```ts
  it("fires onHistoryNavigate('up') on ArrowUp at editor start", () => {
    const onHistoryNavigate = vi.fn();
    render(() => <ChipInput onChange={() => {}} onHistoryNavigate={onHistoryNavigate} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(onHistoryNavigate).toHaveBeenCalledWith("up");
  });

  it("does NOT fire history nav on ArrowUp when caret is mid-text", () => {
    const onHistoryNavigate = vi.fn();
    render(() => <ChipInput onChange={() => {}} onHistoryNavigate={onHistoryNavigate} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    typeText(ed, "ab");
    // caret sits after "ab" — not at start
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(onHistoryNavigate).not.toHaveBeenCalled();
  });

  it("fires onHistoryNavigate('down') on ArrowDown at editor end", () => {
    const onHistoryNavigate = vi.fn();
    render(() => <ChipInput onChange={() => {}} onHistoryNavigate={onHistoryNavigate} />);
    const ed = screen.getByRole("textbox") as HTMLElement;
    typeText(ed, "ab");
    caretAtEnd(ed);
    fireEvent.keyDown(ed, { key: "ArrowDown" });
    expect(onHistoryNavigate).toHaveBeenCalledWith("down");
  });

  it("setText replaces content, emits onChange, and is exposed via registerApi", () => {
    let api: ChipInputApi | undefined;
    const onChange = vi.fn();
    render(() => <ChipInput onChange={onChange} registerApi={(a) => (api = a)} />);
    api!.setText("recalled prompt");
    const ed = screen.getByRole("textbox") as HTMLElement;
    expect(ed.textContent).toBe("recalled prompt");
    expect(onChange).toHaveBeenLastCalledWith("recalled prompt");
  });
```

**Step 2: Run — expect FAIL**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx > /tmp/opencode/ph4.log 2>&1; echo $?; rg "FAIL|Tests " /tmp/opencode/ph4.log | tail -3
```

**Step 3a: Add caret-end helpers** to `chip-model.ts`:

```ts
export function isPointAtEditorEnd(editor: HTMLElement, node: Node, offset: number): boolean {
  if (node === editor) {
    return offset === editor.childNodes.length;
  }
  const len =
    node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;
  if (offset !== len) {
    return false;
  }
  let cur: Node | null = node;
  while (cur && cur !== editor) {
    if (cur.nextSibling) {
      return false;
    }
    cur = cur.parentNode;
  }
  return cur === editor;
}

export function isAtEditorEnd(editor: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return editor.childNodes.length === 0;
  }
  const range = sel.getRangeAt(0);
  if (!range.collapsed) {
    return false;
  }
  return isPointAtEditorEnd(editor, range.endContainer, range.endOffset);
}
```

**Step 3b: Update `chip-input.tsx`**

- Import: add `isAtEditorEnd` to the `chip-model` import.
- Add `onHistoryNavigate?: (dir: "up" | "down") => void;` to `ChipInputProps`.
- Add `setText: (text: string) => void;` to `ChipInputApi`.
- In `onKeyDown`, AFTER the `tokenAnchor && MENU_KEYS` block and BEFORE the `Enter` block, add:

```ts
if (!tokenAnchor && editorRef && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
  if (e.key === "ArrowUp" && isAtEditorStart(editorRef)) {
    e.preventDefault();
    props.onHistoryNavigate?.("up");
    return;
  }
  if (e.key === "ArrowDown" && isAtEditorEnd(editorRef)) {
    e.preventDefault();
    props.onHistoryNavigate?.("down");
    return;
  }
}
```

- Add `setText` to the `api` object:

```ts
    setText: (text: string) => {
      const ed = editorRef;
      if (!ed) {
        return;
      }
      ed.textContent = text;
      tokenAnchor = null;
      ed.focus();
      const range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      emit();
    },
```

**Step 4: Run — expect PASS**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chip-input.test.tsx > /tmp/opencode/ph4.log 2>&1; echo $?; rg "Tests " /tmp/opencode/ph4.log | tail -2
```

---

### Task 5: ChatInput wiring (resource + cursor + handler + refetch)

**Files:**

- Modify: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Test: `apps/desktop/src/components/chat-input/__tests__/chat-input-history.test.tsx` (new file, mock-store pattern from `chat-input-at-fetch.test.tsx`)

**Step 1: Write the failing test**

```tsx
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ChatInput } from "../chat-input";

const mockHistoryGet = vi.fn();

vi.mock("~/stores/store-context", () => ({
  useStore: () => ({
    actions: { sendPrompt: vi.fn(), replyPermission: vi.fn() },
    sessions: { get: () => ({ store: { streaming: { phase: "idle" }, turns: [] } }) },
    server: {
      store: {
        activeProjectId: "proj1",
        sessions: {},
        projects: { proj1: { id: "proj1", name: "P", cwd: "/tmp/p", createdAt: 0, updatedAt: 0 } },
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
                json: async () => ({ commands: [], skills: [], agents: [] }),
              }),
            },
            files: { $get: async () => ({ ok: true, json: async () => ({ files: [] }) }) },
            "prompt-history": { $get: mockHistoryGet },
          },
        },
        models: {
          available: {
            $get: async () => ({ ok: false, json: async () => [] }),
            ":provider": { $get: async () => ({ ok: false, json: async () => [] }) },
          },
          connected: { $get: async () => ({ ok: false, json: async () => [] }) },
        },
      },
    },
  }),
}));

function caretAtStart(editor: HTMLElement) {
  editor.focus();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

beforeEach(() => {
  mockHistoryGet.mockReturnValue({
    ok: true,
    json: async () => ({ prompts: ["newest", "older"] }),
  });
});
afterEach(() => {
  cleanup();
  mockHistoryGet.mockReset();
});

describe("ChatInput prompt history", () => {
  it("ArrowUp recalls newest, then older; ArrowDown goes forward", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const ed = (await screen.findByRole("textbox")) as HTMLElement;
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("newest");
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("older");
    fireEvent.keyDown(ed, { key: "ArrowDown" });
    expect(ed.textContent).toBe("newest");
  });

  it("ArrowDown past newest restores the draft", async () => {
    render(() => <ChatInput placeholder="p" sessionId={null} onSend={vi.fn()} />);
    const ed = (await screen.findByRole("textbox")) as HTMLElement;
    ed.focus();
    // type a draft
    ed.textContent = "my draft";
    fireEvent.input(ed);
    caretAtStart(ed);
    fireEvent.keyDown(ed, { key: "ArrowUp" });
    expect(ed.textContent).toBe("newest");
    fireEvent.keyDown(ed, { key: "ArrowDown" });
    expect(ed.textContent).toBe("my draft");
  });
});
```

**Step 2: Run — expect FAIL**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input-history.test.tsx > /tmp/opencode/ph5.log 2>&1; echo $?; rg "FAIL|Tests " /tmp/opencode/ph5.log | tail -3
```

**Step 3: Wire into `chat-input.tsx`**

Imports — add to existing blocks:

```ts
import {
  historyDown,
  historyUp,
  historyCurrent,
  initialHistoryNav,
  type HistoryNavState,
} from "./prompt-history.ts";
```

After the `files` resource block (around line 95), add the history resource:

```ts
const [history, { refetch: refetchHistory }] = createResource(
  () => projectId(),
  async (pid) => {
    if (!pid) {
      return [];
    }
    const res = await api.api.projects[":id"]["prompt-history"].$get({
      param: { id: pid },
      query: {},
    });
    if (!res.ok) {
      return [];
    }
    const body = await res.json();
    return body.prompts as string[];
  },
);

let histNav: HistoryNavState = initialHistoryNav;
const onHistoryNavigate = (dir: "up" | "down") => {
  const list = history() ?? [];
  if (list.length === 0) {
    return;
  }
  histNav = dir === "up" ? historyUp(histNav, list, value()) : historyDown(histNav);
  const text = historyCurrent(histNav, list);
  chipApi?.setText(text ?? histNav.draft);
};
```

In `send()`, after `chipApi?.clear();`, reset + refetch:

```ts
histNav = initialHistoryNav;
void refetchHistory();
```

Pass the handler to `ChipInput` (in the JSX props):

```tsx
onHistoryNavigate = { onHistoryNavigate };
```

**Step 4: Run — expect PASS**

```bash
vp run desktop#test -- apps/desktop/src/components/chat-input/__tests__/chat-input-history.test.tsx > /tmp/opencode/ph5.log 2>&1; echo $?; rg "Tests " /tmp/opencode/ph5.log | tail -2
```

---

### Task 6: Final verification

**Step 1:** Full server + desktop suites (one run each, capture to file):

```bash
vp run '@sakti-code/server#test' > /tmp/opencode/ph-final-server.log 2>&1; echo $?
vp run desktop#test > /tmp/opencode/ph-final-desktop.log 2>&1; echo $?
rg "Tests " /tmp/opencode/ph-final-server.log /tmp/opencode/ph-final-desktop.log
```

**Step 2:** Lint + typecheck:

```bash
vp check > /tmp/opencode/ph-check.log 2>&1; echo $?
rg "pass:|error|warning" /tmp/opencode/ph-check.log | head
```

Expected: all suites green; `vp check` reports no warnings/lint/type errors.

**Step 3:** Manual smoke (GUI, optional): `vp run desktop#dev` → type a prompt, send, press ArrowUp to recall.
