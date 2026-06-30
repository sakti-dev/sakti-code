# Intake Session + Onboarding Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a persistent per-project intake session with an onboarding chat panel where users discuss features, and new task sessions are dispatched when plans are confirmed.

**Architecture:** One lazy intake session per project (marked `kind='intake'` in DB). Onboarding panel renders a message timeline + chat input bound to the intake session. When the agent calls `propose_session`, the client shows an inline confirm UI; on confirm, a task session is created with a pre-filled first prompt.

**Tech Stack:** SolidJS, Hono REST + WS, node:sqlite + Drizzle, Velomark (workspace package), Kobalte, MiniSearch, TailwindCSS v4.

**Porting strategy:** Copy files from `openspec/references/sakti-code-old/apps/desktop/src/` then edit imports and data wiring to match the current system. This preserves visual design and component structure.

## Import mapping (old → new)

| Old import                                | New import                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| `@/utils` (cn)                            | `~/lib/utils`                                                                       |
| `@/components/ui/command`                 | `~/components/ui/command` (already exists)                                          |
| `@/components/ui/collapsible`             | `~/components/ui/collapsible` (already exists)                                      |
| `lucide-solid`                            | `solid-icons/fi` or `solid-icons/io5`                                               |
| `useChatContext()` / `chat.sendMessage()` | `useStore()` + `actions.sendPrompt(sessionId, text)`                                |
| `chat.streaming.status()`                 | `sessionStore.streaming.phase` (`"thinking" \| "writing" \| "tool_running" \| ...`) |
| `useWorkspace()`                          | `useStore()` (server store has `activeProjectId`, `activeSessionId`)                |
| `ProviderClient` API                      | Hono RPC `api.api.models.available.$get()`, `api.api.auth.$get()`                   |
| `useSessionTurns()`                       | New turn projection from `SessionStoreData` (see Phase 3)                           |

## Icon mapping (lucide-solid → solid-icons)

| lucide-solid              | solid-icons                            |
| ------------------------- | -------------------------------------- |
| `Send`                    | `FiSend`                               |
| `Loader2`                 | `FiLoader` (with `animate-spin` class) |
| `AtSign`                  | `FiAtSign`                             |
| `Paperclip`               | `FiPaperclip`                          |
| `FileText`                | `FiFileText`                           |
| `Folder` / `FolderSearch` | `FiFolder`                             |
| `Terminal`                | `FiTerminal`                           |
| `Search`                  | `FiSearch`                             |
| `Shield`                  | `FiShield`                             |
| `Help`                    | `FiHelpCircle`                         |

---

## Phase 1: Intake Session Foundation + Onboarding Shell

**Deliverable:** Open a project → intake session is upserted → onboarding panel replaces `NoSessionSelected` stub. No chat yet — just the panel shell showing a welcome state.

**Stop point:** Review intake session creation + panel shell before building chat input.

### Task 1.1: DB migration — add `kind` column to sessions

**Files:**

- Modify: `packages/db/src/schema.ts:17-30`

**Step 1:** Add the `kind` column to the sessions table:

```ts
// In packages/db/src/schema.ts, inside the sessions table definition:
kind: text("kind").notNull().default("task"),
```

Add it after `modelId` (line 25). The column is `TEXT NOT NULL DEFAULT 'task'` so existing rows backfill automatically.

**Step 2:** Verify typecheck:

```bash
cd packages/db && nub run typecheck
```

**Step 3:** Write test — verify default kind is `'task'`:

**Test file:** `packages/db/src/__tests__/sessions-kind.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { initDatabase, SessionRepo, ProjectRepo, type DrizzleDB } from "../index.ts";
import { rmSync } from "node:fs";

describe("sessions kind column", () => {
  let db: DrizzleDB;
  let projectRepo: ProjectRepo;
  let sessionRepo: SessionRepo;
  let dbPath: string;

  beforeEach(() => {
    dbPath = `/tmp/test-kind-${Date.now()}.db`;
    db = initDatabase(dbPath);
    projectRepo = new ProjectRepo(db);
    sessionRepo = new SessionRepo(db);
  });

  afterEach(() => rmSync(dbPath, { force: true }));

  it("defaults to 'task' when not specified", () => {
    const project = projectRepo.create("test", "/tmp/test");
    const session = sessionRepo.create(project.id, "test-model");
    expect(session.kind).toBe("task");
  });

  it("can be set to 'intake'", () => {
    const project = projectRepo.create("test", "/tmp/test");
    const session = sessionRepo.create(project.id, "test-model", { kind: "intake" });
    expect(session.kind).toBe("intake");
  });
});
```

**Step 4:** Run test → expect FAIL (kind not in create options yet).

```bash
cd packages/db && nub run test
```

### Task 1.2: SessionRepo — support `kind` in create + add `findIntakeByProject`

**Files:**

- Modify: `packages/db/src/repos/index.ts:68-96` (create method)
- Modify: `packages/db/src/repos/index.ts:111-126` (update Pick list)

**Step 1:** Add `kind` to the `create` options and insert:

```ts
// In SessionRepo.create, update the options type:
async create(
  projectId: string,
  modelId: string,
  options?: {
    title?: string;
    thinkingLevel?: string;
    parentSessionId?: string;
    kind?: string;
  }
) {
  // ... inside .values({ ... }):
  kind: options?.kind ?? "task",
  // ... rest stays the same
}
```

**Step 2:** Add `findIntakeByProject` method:

```ts
// Add to SessionRepo class, after findById:
findIntakeByProject(projectId: string) {
  return this.db
    .select()
    .from(sessions)
    .where(and(eq(sessions.projectId, projectId), eq(sessions.kind, "intake")))
    .get();
}
```

Import `and` from `drizzle-orm` at the top of the file.

**Step 3:** Run tests → expect PASS.

```bash
cd packages/db && nub run test
```

**Step 4:** Commit.

```bash
git add packages/db/src/schema.ts packages/db/src/repos/index.ts packages/db/src/__tests__/sessions-kind.test.ts
git commit -m "feat(db): add kind column to sessions + findIntakeByProject"
```

### Task 1.3: Server — intake upsert endpoint

**Files:**

- Create: `apps/server/src/routes/projects/intake-session.ts`
- Modify: `apps/server/src/app.ts` (register route)

**Step 1:** Create the route file:

```ts
import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { resolveModelRef } from "../../lib/profile-resolver.ts";

export const intakeSessionRoutes = new Hono()
  .basePath("/projects")
  .post("/:id/intake-session", async (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = await ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Check for existing intake session
    const existing = ctx.repos.sessions.findIntakeByProject(projectId);
    if (existing) {
      return c.json(existing);
    }

    // Resolve model from project profile
    const profiles = await ctx.profiles.read();
    const modelRef = resolveModelRef(profiles, project.profileId, "default");

    const created = await ctx.repos.sessions.create(projectId, modelRef.modelId, {
      kind: "intake",
      title: "Intake",
      thinkingLevel: modelRef.thinkingLevel ?? "off",
    });
    return c.json(created, 201);
  });
```

**Step 2:** Register in `app.ts`:

```ts
// Add import at top:
import { intakeSessionRoutes } from "./routes/projects/intake-session.ts";

// In buildApp, add after projectsRoutes (line 27):
.route("/", intakeSessionRoutes)
```

**Step 3:** Write server test — verify upsert returns existing or creates new:

**Test file:** `apps/server/src/routes/projects/__tests__/intake-session.test.ts`

Pattern: follow existing server tests. Create a project, POST to `/api/projects/:id/intake-session`, assert 201 + `kind: "intake"`. POST again, assert 200 + same session ID.

**Step 4:** Run tests.

```bash
cd apps/server && nub run test
```

**Step 5:** Commit.

```bash
git add apps/server/src/routes/projects/intake-session.ts apps/server/src/app.ts apps/server/src/routes/projects/__tests__/intake-session.test.ts
git commit -m "feat(server): add POST /api/projects/:id/intake-session upsert endpoint"
```

### Task 1.4: Server — session creation accepts `kind` + `parentSessionId`

**Files:**

- Modify: `apps/server/src/routes/sessions/sessions.ts:24-70` (POST handler)

**Step 1:** Update the TypeBox schema for POST `/sessions` to accept optional `kind` and `parentSessionId`:

```ts
// In the POST handler validation:
.post("/", tbValidator("json", Type.Object({
  projectId: Type.String(),
  modelId: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  kind: Type.Optional(Type.String()),
  parentSessionId: Type.Optional(Type.String()),
})), async (c) => {
```

**Step 2:** Pass `kind` and `parentSessionId` through to `ctx.repos.sessions.create`:

```ts
const created = await ctx.repos.sessions.create(body.projectId, modelId, {
  ...(body.title === undefined ? {} : { title: body.title }),
  ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  ...(body.kind === undefined ? {} : { kind: body.kind }),
  ...(body.parentSessionId === undefined ? {} : { parentSessionId: body.parentSessionId }),
});
```

**Step 3:** Run server tests.

```bash
cd apps/server && nub run test
```

**Step 4:** Commit.

```bash
git add apps/server/src/routes/sessions/sessions.ts
git commit -m "feat(server): accept kind + parentSessionId in POST /sessions"
```

### Task 1.5: Desktop — actions.upsertIntakeSession

**Files:**

- Modify: `apps/desktop/src/stores/server/actions.ts` (add method)
- Modify: `apps/desktop/src/stores/server/server-store.ts` (add SessionMeta.kind)

**Step 1:** Add `kind` to `SessionMeta`:

```ts
// In server-store.ts:
export interface SessionMeta {
  createdAt: number;
  id: string;
  kind: "intake" | "task"; // <-- add this
  modelId: string;
  projectId: string;
  thinkingLevel: string;
  title: string | null;
  updatedAt: number;
}
```

**Step 2:** Add `upsertIntakeSession` to the Actions interface and implementation:

```ts
// In the Actions interface:
upsertIntakeSession: (projectId: string) => Promise<SessionMeta | undefined>;

// In the createActions implementation:
upsertIntakeSession: async (projectId: string) => {
  try {
    const res = await api.api.projects[":id"]["intake-session"].$post({
      param: { id: projectId },
    });
    if (!res.ok) return;
    const session = (await res.json()) as SessionMeta;
    server.actions.addSession(session);
    return session;
  } catch (err) {
    setLastError(`Failed to upsert intake session: ${err}`);
  }
},
```

> **Note:** The Hono RPC type for the new endpoint is auto-derived from `App`. After adding the route to the server and running typecheck, the client type will include it. If the RPC path doesn't resolve, use `fetch("/api/projects/" + projectId + "/intake-session", { method: "POST" })` as a fallback.

**Step 3:** Write test for upsertIntakeSession (mock fetch, verify addSession called).

**Step 4:** Run typecheck + tests:

```bash
nub run typecheck
cd apps/desktop && nub run test
```

**Step 5:** Commit.

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/server-store.ts apps/desktop/src/stores/server/__tests__/actions.test.ts
git commit -m "feat(desktop): add upsertIntakeSession action + kind on SessionMeta"
```

### Task 1.6: Desktop — workspace integration (upsert on project open)

**Files:**

- Modify: `apps/desktop/src/components/layout/workspace-layout.tsx`

**Step 1:** Add an effect that upserts the intake session when a project is active:

```ts
// In WorkspaceLayout component, add after the existing createEffect for activeTab:
const [intakeSessionId, setIntakeSessionId] = createSignal<string | null>(null);

createEffect(() => {
  const projectId = server.store.activeProjectId;
  if (!projectId) return;

  // Upsert intake session for this project
  void actions.upsertIntakeSession(projectId).then((session) => {
    if (session) {
      setIntakeSessionId(session.id);
    }
  });
});
```

**Step 2:** Update the view logic to use the intake session:

```ts
// Replace the NoSessionSelected fallback with:
const showOnboarding = () => {
  const tab = activeTab();
  if (!tab || tab.projectId === null) return false;
  // Show onboarding when no task session is selected
  return tab.sessionId === null || tab.sessionId === intakeSessionId();
};
```

**Step 3:** Replace the `<NoSessionSelected>` / `<Show when={activeSession()}>` block with:

```tsx
<Show when={showOnboarding()} fallback={<TaskChatStub />}>
  <OnboardingPanel projectId={server.store.activeProjectId!} intakeSessionId={intakeSessionId()} />
</Show>
```

**Step 4:** Commit (after Task 1.7).

### Task 1.7: Desktop — onboarding panel shell

**Files:**

- Create: `apps/desktop/src/components/onboarding/onboarding-panel.tsx`
- Create: `apps/desktop/src/components/onboarding/welcome-panel.tsx`

**Step 1:** Copy `homepage-panel.tsx` from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/homepage-panel.tsx \
   apps/desktop/src/components/onboarding/onboarding-panel.tsx
```

**Step 2:** Edit `onboarding-panel.tsx`:

- Replace `@/` imports with `~/` imports
- Remove `useChatContext` — use `useStore()` instead
- Remove `WelcomePanel` import from `@/components/welcome-panel` — we'll create a local one
- Remove `useSessionTurns` — for now, read messages directly from `sessionRegistry.get(intakeSessionId).store`
- Remove `isGenerating` / `showWelcome` complex logic — simplify to `store.streaming.phase !== "idle"`
- Remove `handleAction` / `pendingWorkflowAction` — not needed yet
- Keep the structure: Show + MessageTimeline + ChatInput
- Replace `<MessageTimeline>` with a placeholder `<div>Chat timeline coming in Phase 3</div>` for now
- Replace `<ChatInput>` with a placeholder `<div>Chat input coming in Phase 2</div>` for now
- Keep the `<WelcomePanel>` when no messages

**Step 3:** Create a simple welcome panel (copy from reference `welcome-panel.tsx` if it exists, otherwise create minimal):

```tsx
// apps/desktop/src/components/onboarding/welcome-panel.tsx
import { For } from "solid-js";

interface Suggestion {
  icon: string;
  label: string;
  prompt: string;
}

const SUGGESTIONS: Suggestion[] = [
  { icon: "💡", label: "New feature", prompt: "I want to add a new feature" },
  { icon: "🐛", label: "Bug fix", prompt: "I found a bug" },
  { icon: "🔬", label: "Research", prompt: "Help me understand this codebase" },
];

export function WelcomePanel() {
  return (
    <div class="flex flex-1 flex-col items-center justify-center px-4">
      <div class="w-full max-w-md text-center">
        <div class="mb-3 text-4xl">{"\u{1F967}"}</div>
        <h2 class="mb-1 font-semibold text-foreground text-lg">How can I help?</h2>
        <p class="mb-6 text-muted-foreground text-sm">
          Describe a feature, bug, or question. We'll plan it together before starting a session.
        </p>
        <div class="grid grid-cols-1 gap-2">
          <For each={SUGGESTIONS}>
            {(s) => (
              <div class="flex items-center gap-3 rounded-lg border border-border p-3 text-left text-sm hover:bg-muted">
                <span class="text-xl">{s.icon}</span>
                <span class="text-foreground">{s.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
```

**Step 4:** Write a basic test that the panel renders without crashing.

**Step 5:** Run typecheck + tests + lint.

**Step 6:** Commit.

```bash
git add apps/desktop/src/components/onboarding/ apps/desktop/src/components/layout/workspace-layout.tsx
git commit -m "feat(desktop): intake session onboarding panel shell + workspace integration"
```

---

## Phase 2: Chat Input + Model Picker Dialog

**Deliverable:** User can type messages in the onboarding panel, select models via the command center dialog, and send prompts to the intake session over WS. Basic text-only message display (no parts/tools yet).

**Stop point:** Review chat input + model picker before building full message rendering.

### Task 2.1: Velomark workspace package setup

**Files:**

- Modify: `packages/velomark/package.json` (exports)
- Modify: `apps/desktop/package.json` (add dependency)
- Run: `pnpm install`

**Step 1:** Update velomark `package.json` exports to workspace TS resolution:

```json
{
  "exports": {
    ".": {
      "solid": "./src/index.tsx",
      "default": "./src/index.tsx"
    },
    "./styles.css": "./src/theme/styles.css"
  }
}
```

Remove the `"main"`, `"module"`, `"types"`, `"browser"` fields — not needed for workspace TS resolution. Keep `"sideEffects"`, `"peerDependencies"`, `"dependencies"`.

**Step 2:** Add velomark to desktop dependencies:

```json
// In apps/desktop/package.json dependencies:
"velomark": "workspace:*",
```

Also add `minisearch`:

```json
"minisearch": "^7.1.0",
```

**Step 3:** Run `pnpm install` to link.

**Step 4:** Verify typecheck passes for velomark:

```bash
cd packages/velomark && npx tsc --noEmit
```

**Step 5:** Import velomark styles in desktop. Add to `apps/desktop/src/app.css` or the main entry:

```css
@import "velomark/styles.css";
```

**Step 6:** Commit.

```bash
git add packages/velomark/package.json apps/desktop/package.json apps/desktop/src/app.css
git commit -m "chore: wire velomark as workspace package + add minisearch"
```

### Task 2.2: Provider selection store

**Strategy:** Copy `provider-selection-store.ts` from reference, adapt to current API.

**Files:**

- Create: `apps/desktop/src/stores/model/provider-selection-store.ts`

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/core/state/providers/provider-selection-store.ts \
   apps/desktop/src/stores/model/provider-selection-store.ts
```

**Step 2:** Edit — replace `ProviderClient` API calls with Hono RPC calls:

Old:

```ts
const [providers, auth, models, preferences] = await Promise.all([
  client.listProviders(),
  client.listAuthStates(),
  client.listModels(),
  client.getPreferences(),
]);
```

New — adapt to current endpoints:

```ts
// Fetch available providers + models
const providersRes = await api.api.models.available.$get();
const providers = providersRes.ok ? await providersRes.json() : []; // string[]

// Fetch auth states (which providers have keys)
const authRes = await api.api.auth.$get();
const authData = authRes.ok ? await authRes.json() : [];

// Fetch models per provider
const models: ProviderModel[] = [];
for (const provider of providers) {
  const res = await api.api.models.available[":provider"].$get({ param: { provider } });
  if (res.ok) {
    const providerModels = await res.json();
    models.push(...providerModels);
  }
}

// No global preferences — model selection is per-session
const preferences = { selectedModelId: "", selectedProviderId: null };
```

**Step 3:** Edit — remove `setSelectedModel` server persistence (model selection is per-session via `server.actions.updateSession`). Replace with a local signal that the caller reads.

**Step 4:** Edit — remove `console.log` debug statements (AGENTS.md violation).

**Step 5:** Remove `PROVIDER_SELECTION_REFRESH_EVENT` window listener — not needed.

**Step 6:** Keep the core search logic intact: `MiniSearch` index, `scoreModelMatch`, `rankModels`, `expandQueryTerms`, `search`, `connectedResults`, `notConnectedResults`, `providerGroupedSections`, caches.

**Step 7:** Write tests for search ranking (port from reference tests if available).

**Step 8:** Commit.

```bash
git add apps/desktop/src/stores/model/
git commit -m "feat(desktop): provider selection store with MiniSearch model ranking"
```

### Task 2.3: ModelSelector dialog (model mode only)

**Files:**

- Create: `apps/desktop/src/components/model-selector/model-selector.tsx`
- Create: `apps/desktop/src/components/model-selector/model-selector.css` (aurora/grain effects)

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/components/model-selector.tsx \
   apps/desktop/src/components/model-selector/model-selector.tsx
```

**Step 2:** Edit — strip down to `/model` mode only:

- Remove `CommandCenterMode` type — no multi-mode
- Remove `SKILL_ENTRIES`, `MCP_ENTRIES`, `MODE_PILLS` constants
- Remove `slashCommands`, `onSlashCommand`, `fileSearchResults`, `onFileSelect`, `workspaceRoot` props
- Remove the mode pills UI section
- Remove the `commandEntries` memo and all non-model rendering branches
- Remove `handleCommandPick`, `handleFileSelect`
- Keep: virtual list logic, `modelRows`, `visibleModelRows`, `modelRowIndexById`, keyboard nav, scroll management
- Simplify the header: just "Selecting model" / "Command Center" title, no mode pills
- Simplify the search placeholder: just "Search providers and models..."
- Keep the footer keybinds

**Step 3:** Edit imports:

- `@/components/ui/command` → `~/components/ui/command`
- `@/utils` → `~/lib/utils`
- Remove `@sakti-code/core/chat` import (SlashCommand type)
- Remove `@/utils/path-utils` (middleEllipsisPath) — not needed without context mode

**Step 4:** Simplify the props interface:

```ts
interface ModelSelectorProps {
  modelSections: ModelSelectorSection[];
  onOpenChange: (open: boolean) => void;
  onSearchChange: (query: string) => void;
  onSelect: (modelId: string) => void;
  open: boolean;
  searchQuery?: string;
  selectedModelId?: string;
}
```

**Step 5:** Copy the aurora/grain CSS from reference (or create minimal equivalents).

**Step 6:** Write test — render dialog, verify model list renders, keyboard nav works.

**Step 7:** Commit.

```bash
git add apps/desktop/src/components/model-selector/
git commit -m "feat(desktop): model selector dialog with virtual list + keyboard nav"
```

### Task 2.4: ModelSelectorButton

**Files:**

- Create: `apps/desktop/src/components/model-selector/model-selector-button.tsx`

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/input/model-selector-button.tsx \
   apps/desktop/src/components/model-selector/model-selector-button.tsx
```

**Step 2:** Edit — strip context/file-search props:

- Remove `commandMode`, `setCommandMode`, `fileSearchResults`, `setFileSearchResults`, `getFileSearchResults`, `workspaceRoot`, `inputValue`, `onValueChange` props
- Remove `handleFileSelect` method
- Simplify to just: toggle button + ModelSelector dialog
- The button label shows the current model name

**Step 3:** Edit imports: `@/components/model-selector` → `~/components/model-selector/model-selector`.

**Step 4:** Commit.

### Task 2.5: SendButton + InputFooter

**Files:**

- Create: `apps/desktop/src/components/chat-input/send-button.tsx`
- Create: `apps/desktop/src/components/chat-input/input-footer.tsx`

**Step 1:** Copy from reference, edit icon imports:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/input/send-button.tsx \
   apps/desktop/src/components/chat-input/send-button.tsx
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/input/input-footer.tsx \
   apps/desktop/src/components/chat-input/input-footer.tsx
```

**Step 2:** Edit `send-button.tsx`: `lucide-solid` → `solid-icons/fi`:

```ts
// Old: import { Loader2, Send } from "lucide-solid";
// New:
import { FiLoader, FiSend } from "solid-icons/fi";
// Replace <Loader2 class="h-4 w-4 animate-spin" /> with <FiLoader class="h-4 w-4 animate-spin" />
// Replace <Send class="h-4 w-4" /> with <FiSend class="h-4 w-4" />
```

**Step 3:** Edit `input-footer.tsx`: `@/utils` → `~/lib/utils`. Otherwise unchanged.

**Step 4:** Commit.

### Task 2.6: ChatInput component

**Files:**

- Create: `apps/desktop/src/components/chat-input/chat-input.tsx`
- Create: `apps/desktop/src/components/chat-input/use-chat-input.ts`

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/input/chat-input.tsx \
   apps/desktop/src/components/chat-input/chat-input.tsx
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/input/use-chat-input.tsx \
   apps/desktop/src/components/chat-input/use-chat-input.ts
```

**Step 2:** Edit `use-chat-input.ts` — major rewrite of data wiring:

Remove all of these (not needed for MVP):

- `usePermissionStore`, `useQuestionStore`, `usePermissions`
- `currentPendingPermission`, `currentPendingQuestion`, `isPromptBlocked`
- `pendingPermissionBanner`, `handleApprovePermission`, `handleDenyPermission`
- `handleAnswerQuestion`, `handleRejectQuestion`
- `useFileSearch`, `getFileSearchResults`
- `agentMode`, `setAgentMode`
- `pendingWorkflowAction`, `stageWorkflowAction`, `clearPendingWorkflowAction`
- `effectivePlaceholder` (use static "Send a message...")

Replace `chat.sendMessage()` with:

```ts
const handleSendMessage = async () => {
  const content = draftMessage().trim();
  if (!content || isGenerating()) return;
  actions.sendPrompt(sessionId, content);
  setDraftMessage("");
};
```

Where `actions` comes from `useStore()` and `sessionId` is passed in.

Replace `chat.streaming.status()` with:

```ts
const isGenerating = () => {
  const session = sessionRegistry.get(sessionId);
  return (
    session.store.streaming.phase === "thinking" ||
    session.store.streaming.phase === "writing" ||
    session.store.streaming.phase === "tool_running"
  );
};
```

Wire model selection to `providerSelectionStore` (from Task 2.2) + `server.actions.updateSession(sessionId, { modelId })`.

**Step 3:** Edit `chat-input.tsx`:

- Replace `@/` imports with `~/` imports
- Remove `PermissionBanner`, `InputToolbar` (Plan/Build toggle, @mention, attach)
- Remove slash-command detection (`/model`, `/mcp`, `/skills`, `@`)
- Remove `commandMode`, `modelSearch`, `fileSearchResults` state
- Remove `defaultChatInput` fallback context pattern — pass props directly
- Keep: textarea + auto-resize, ModelSelectorButton, SendButton, InputFooter
- The `ModelSelectorButton` is triggered by a simple click (not slash command)

Simplified `ChatInputProps`:

```ts
export interface ChatInputProps {
  class?: string;
  disabled?: boolean;
  onSend?: () => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  value?: string;
  // Model selector
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
}
```

**Step 4:** Wire the textarea + auto-resize (keep from reference — it's already correct).

**Step 5:** Wire keyboard: Enter=send, Shift+Enter=newline (keep from reference).

**Step 6:** Write test — render ChatInput, type text, verify onValueChange/onSend called.

**Step 7:** Commit.

```bash
git add apps/desktop/src/components/chat-input/
git commit -m "feat(desktop): chat input with textarea + model selector + send button"
```

### Task 2.7: Integrate chat input into onboarding panel

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx`

**Step 1:** Replace the ChatInput placeholder with the real component:

```tsx
import { ChatInput } from "~/components/chat-input/chat-input";

// In OnboardingPanel:
const [inputValue, setInputValue] = createSignal("");

// Replace the placeholder div with:
<ChatInput
  value={inputValue()}
  onValueChange={setInputValue}
  onSend={() => {
    if (!intakeSessionId()) return;
    actions.sendPrompt(intakeSessionId()!, inputValue());
    setInputValue("");
  }}
  placeholder="Ask anything about this project..."
  selectedModel={server.store.sessions[intakeSessionId() ?? ""]?.modelId}
  onModelChange={(modelId) => {
    if (intakeSessionId()) {
      server.actions.updateSession(intakeSessionId()!, { modelId });
    }
  }}
/>;
```

**Step 2:** Add basic message display (temporary — Phase 3 replaces with full timeline):

```tsx
// Simple message list until Phase 3:
const sessionStore = () => {
  if (!intakeSessionId()) return null;
  return sessionRegistry.get(intakeSessionId()!);
};

// Replace timeline placeholder with:
<div class="flex-1 overflow-y-auto p-4">
  <For each={sessionStore()?.store.messageOrder ?? []}>
    {(msgId) => {
      const msg = () => sessionStore()!.store.messages[msgId];
      return (
        <div class={`mb-3 ${msg().role === "user" ? "text-right" : ""}`}>
          <div
            class={`inline-block rounded-lg px-3 py-2 text-sm ${
              msg().role === "user"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground"
            }`}
          >
            {msg().content || "..."}
          </div>
        </div>
      );
    }}
  </For>
</div>;
```

**Step 3:** Run typecheck + tests + lint.

**Step 4:** Commit.

```bash
git add apps/desktop/src/components/onboarding/onboarding-panel.tsx
git commit -m "feat(desktop): wire chat input + basic message display into onboarding panel"
```

---

## Phase 3: Message Rendering System

**Deliverable:** Full message timeline with velomark-powered markdown, tool call rendering, streaming display, auto-scroll. The onboarding chat looks polished.

**Stop point:** Review message rendering before building propose_session tool.

### Task 3.1: Velomark theme integration

**Files:**

- Create: `apps/desktop/src/components/ui/markdown.tsx`
- Create: `apps/desktop/src/components/ui/markdown-integration/theme.ts`
- Create: `apps/desktop/src/components/ui/markdown-integration/contract.ts`

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/components/ui/markdown.tsx \
   apps/desktop/src/components/ui/markdown.tsx
cp openspec/references/sakti-code-old/apps/desktop/src/components/ui/markdown-integration/theme.ts \
   apps/desktop/src/components/ui/markdown-integration/theme.ts
cp openspec/references/sakti-code-old/apps/desktop/src/components/ui/markdown-integration/contract.ts \
   apps/desktop/src/components/ui/markdown-integration/contract.ts
```

**Step 2:** Edit imports: `@/` → `~/`. Update velomark import from npm package to workspace package (should auto-resolve after Task 2.1).

**Step 3:** Remove `markdown-perf-telemetry` references (not porting telemetry).

**Step 4:** Verify `<Markdown text="**hello**" />` renders bold text.

**Step 5:** Commit.

### Task 3.2: Turn projection (UIMessage[] → ChatTurn[])

**Files:**

- Create: `apps/desktop/src/stores/session/turn-projection.ts`

**Step 1:** Create a turn projection function that groups messages into user+assistant pairs.

Unlike the old code's complex projection (which dealt with parts, permissions, questions), our current `UIMessage` model is simpler. A turn = consecutive user message + assistant response(s).

```ts
import type { UIMessage } from "../types.ts";

export interface ChatTurn {
  userMessage: UIMessage | null;
  assistantMessages: UIMessage[];
  working: boolean;
  error: string | null;
}

export function buildChatTurns(
  messageOrder: string[],
  messages: Record<string, UIMessage>,
  streamingPhase: string,
): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let currentTurn: ChatTurn | null = null;

  for (const msgId of messageOrder) {
    const msg = messages[msgId];
    if (!msg) continue;

    if (msg.role === "user") {
      if (currentTurn) turns.push(currentTurn);
      currentTurn = {
        userMessage: msg,
        assistantMessages: [],
        working: false,
        error: null,
      };
    } else if (msg.role === "assistant") {
      if (!currentTurn) {
        currentTurn = { userMessage: null, assistantMessages: [], working: false, error: null };
      }
      currentTurn.assistantMessages.push(msg);
      if (msg.isStreaming) currentTurn.working = true;
      if (msg.error) currentTurn.error = msg.error;
    }
  }

  if (currentTurn) turns.push(currentTurn);

  // Mark last turn as working if streaming
  if (turns.length > 0 && streamingPhase !== "idle") {
    turns[turns.length - 1].working = true;
  }

  return turns;
}
```

**Step 2:** Write tests for turn projection.

**Step 3:** Commit.

### Task 3.3: Parts registry + Part dispatcher

**Files:**

- Create: `apps/desktop/src/components/chat/parts/part-registry.ts`
- Create: `apps/desktop/src/components/chat/parts/message-part.tsx`
- Create: `apps/desktop/src/components/chat/parts/register-parts.ts`

**Step 1:** Copy the parts registry pattern from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/parts/part-registry.ts \
   apps/desktop/src/components/chat/parts/part-registry.ts
```

The registry is self-contained — no import changes needed. Keep the `PartProps` interface and the register/get/has/clear API.

**Step 2:** Create `message-part.tsx` (the dispatcher):

```tsx
// Simplified from reference — dispatches to registered part components
import { Show, type Component } from "solid-js";
import { getPartComponent } from "./part-registry.ts";
import type { MessagePart } from "~/stores/types.ts";

export interface PartProps {
  isStreaming?: boolean;
  part: MessagePart;
}

export const Part: Component<PartProps> = (props) => {
  const Component = () => getPartComponent(props.part.type);
  return <Show when={Component()}>{(Comp) => <Comp {...props} />}</Show>;
};
```

**Step 3:** Create `register-parts.ts` — register text, tool_call, thinking parts.

**Step 4:** Commit.

### Task 3.4: TextPart + ReasoningPart

**Files:**

- Create: `apps/desktop/src/components/chat/parts/text-part.tsx`
- Create: `apps/desktop/src/components/chat/parts/reasoning-part.tsx`

**Step 1:** Copy `text-part.tsx` from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/parts/text-part.tsx \
   apps/desktop/src/components/chat/parts/text-part.tsx
```

**Step 2:** Edit imports:

- `@/components/ui/markdown` → `~/components/ui/markdown`
- `@/utils` → `~/lib/utils`
- Keep the hover copy button

**Step 3:** Create `reasoning-part.tsx` — maps to our `thinking` part type:

Copy and adapt — change the part type check from `"reasoning"` to `"thinking"`.

**Step 4:** Commit.

### Task 3.5: ToolPart + tool rendering subsystem

**Files:**

- Create: `apps/desktop/src/components/chat/parts/tool-part.tsx`
- Create: `apps/desktop/src/components/chat/tools/tool-summary-row.tsx`
- Create: `apps/desktop/src/components/chat/tools/tool-summary-formatters.ts`
- Create: `apps/desktop/src/components/chat/tools/tool-name.ts`
- Create: `apps/desktop/src/components/chat/tools/basic-tool.tsx`

**Step 1:** Copy tool subsystem files from reference:

```bash
# Tool name normalization + inference
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/tools/tool-name.ts \
   apps/desktop/src/components/chat/tools/tool-name.ts

# Summary formatters
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/tools/tool-summary-formatters.ts \
   apps/desktop/src/components/chat/tools/tool-summary-formatters.ts

# Summary row component
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/tools/tool-summary-row.tsx \
   apps/desktop/src/components/chat/tools/tool-summary-row.tsx

# Basic tool collapsible
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/tools/basic-tool.tsx \
   apps/desktop/src/components/chat/tools/basic-tool.tsx

# Tool part renderer
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/parts/tool-part.tsx \
   apps/desktop/src/components/chat/parts/tool-part.tsx
```

**Step 2:** Edit all files: replace `@/` imports with `~/` imports, `lucide-solid` → `solid-icons/fi`.

**Step 3:** Copy `middleEllipsisPath` utility from reference (`@/utils/path-utils`):

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/utils/path-utils.ts \
   apps/desktop/src/lib/utils/path-utils.ts
```

**Step 4:** Verify tool rendering works with our `MessagePart` type. The tool part type in our system is:

```ts
{ type: "tool_call"; toolCallId: string; toolName: string; input: unknown; status: "running" | "done" | "error"; result?: string }
```

Map `status: "running"` → tool is active, `status: "done"` → success, `status: "error"` → error styling.

**Step 5:** Commit.

### Task 3.6: SessionTurn component

**Files:**

- Create: `apps/desktop/src/components/chat/timeline/session-turn.tsx`

**Step 1:** Copy from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/timeline/session-turn.tsx \
   apps/desktop/src/components/chat/timeline/session-turn.tsx
```

**Step 2:** Edit — adapt to our simpler turn model:

- Replace `turn: Accessor<ChatTurn>` (old complex type) with our `ChatTurn` from `turn-projection.ts`
- Our turns don't have `transcriptParts`, `attachmentsByPartId`, `retry`, `turnAttachments`
- Simplify: iterate `assistantMessages`, for each render its `parts` via `<Part>`
- Keep the sticky user shell + working status bar + duration display
- Remove retry display
- Remove screen-reader summary complexity

**Step 3:** Edit imports: `@/` → `~/`, `lucide-solid` → `solid-icons/fi`.

**Step 4:** Commit.

### Task 3.7: MessageTimeline + auto-scroll

**Files:**

- Create: `apps/desktop/src/components/chat/timeline/message-timeline.tsx`
- Create: `apps/desktop/src/lib/utils/create-auto-scroll.ts`

**Step 1:** Copy auto-scroll hook from reference:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/core/shared/utils/create-auto-scroll.ts \
   apps/desktop/src/lib/utils/create-auto-scroll.ts
```

**Step 2:** Edit imports: `@/` → `~/`.

**Step 3:** Copy message timeline:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/timeline/message-timeline.tsx \
   apps/desktop/src/components/chat/timeline/message-timeline.tsx
```

**Step 4:** Edit — adapt to our types:

- Props: `turns: ChatTurn[]`, `isStreaming: () => boolean`
- Use `createAutoScroll({ working: props.isStreaming(), nearBottomDistance: 100, settlingPeriod: 300 })`
- Keep `aria-live="polite"`, `role="log"`
- Render `<SessionTurn>` for each turn

**Step 5:** Copy layout constants:

```bash
cp openspec/references/sakti-code-old/apps/desktop/src/views/workspace-view/chat-area/layout.ts \
   apps/desktop/src/components/chat/layout.ts
```

**Step 6:** Commit.

### Task 3.8: Integrate timeline into onboarding panel

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx`

**Step 1:** Replace the basic message list (from Task 2.7) with the full MessageTimeline:

```tsx
import { MessageTimeline } from "~/components/chat/timeline/message-timeline";
import { buildChatTurns } from "~/stores/session/turn-projection";

// In OnboardingPanel:
const turns = createMemo(() => {
  const session = sessionStore();
  if (!session) return [];
  return buildChatTurns(
    session.store.messageOrder,
    session.store.messages,
    session.store.streaming.phase,
  );
});

const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

// Replace the basic message list with:
<MessageTimeline turns={turns()} isStreaming={isGenerating} />;
```

**Step 2:** Remove the old basic message list code.

**Step 3:** Run typecheck + tests + lint.

**Step 4:** Commit.

```bash
git add apps/desktop/src/components/ apps/desktop/src/lib/utils/ apps/desktop/src/stores/session/turn-projection.ts
git commit -m "feat(desktop): full message rendering system with velomark + parts + tools"
```

---

## Phase 4: propose_session Tool + Intake Agent

**Deliverable:** The intake agent has a distinct system prompt and the `propose_session` tool. When the agent proposes a session, the tool fires and the client detects it.

**Stop point:** Review tool + agent prompt before building confirm UI.

### Task 4.1: propose_session tool

**Files:**

- Create: `packages/tools/src/tools/propose-session.ts`
- Modify: `packages/tools/src/index.ts` (export)

**Step 1:** Create the tool:

```ts
import type { AgentTool } from "@sakti-code/agent";
import { type Static, Type } from "typebox";

const proposeSessionSchema = Type.Object({
  title: Type.String({ description: "A short title for the task session" }),
  message: Type.String({
    description:
      "The pre-filled first message for the task session. This should contain the full context, requirements, and rough plan discussed with the user.",
  }),
});

export type ProposeSessionToolInput = Static<typeof proposeSessionSchema>;

export function createProposeSessionTool(): AgentTool<typeof proposeSessionSchema, undefined> {
  return {
    name: "propose_session",
    label: "propose_session",
    description: `Call this tool when you and the user have agreed on a plan for a new feature, bug fix, or change. This creates a proposal for a new task session with a pre-filled message. The user will be asked to confirm before the session is created. Always call this tool as the LAST action in your turn — it terminates your run. The "message" field should be a complete, self-contained brief that a fresh agent (with no prior context) can understand and act on.`,
    parameters: proposeSessionSchema,
    async execute() {
      return {
        content: [{ type: "text" as const, text: "Session proposed. Awaiting user confirmation." }],
        details: undefined,
        terminate: true,
      };
    },
  };
}
```

**Step 2:** Export in `packages/tools/src/index.ts`:

```ts
export type { ProposeSessionToolInput } from "./tools/propose-session.ts";
export { createProposeSessionTool } from "./tools/propose-session.ts";
```

**Step 3:** Write test — verify tool returns terminate: true.

**Step 4:** Commit.

```bash
git add packages/tools/src/tools/propose-session.ts packages/tools/src/index.ts packages/tools/src/tools/__tests__/propose-session.test.ts
git commit -m "feat(tools): add propose_session tool with terminate: true"
```

### Task 4.2: Intake agent system prompt

**Files:**

- Create: `packages/agent/src/prompts/intake-system-prompt.ts`
- Modify: `apps/server/src/agent/runner.ts` (resolve prompt by session kind)

**Step 1:** Create the intake system prompt:

```ts
export const INTAKE_SYSTEM_PROMPT = `You are the project's intake agent — a product manager who helps users plan work before implementation.

Your role:
- Discuss new features, bug fixes, and improvements with the user
- Research the codebase to understand feasibility and impact
- Write rough change-request documents (markdown) when needed
- When the plan is locked in and the user agrees, call propose_session

You have the full toolset (read, write, edit, bash, grep, find, ls). Use it to research and write docs, but do NOT implement features — that happens in task sessions.

When calling propose_session:
- Write a complete, self-contained "message" that a fresh agent can understand
- Include: what to build, why, key files/constraints discovered, and the rough plan
- The message IS the task session's first prompt — make it count

After calling propose_session, your turn ends. The user will confirm or ask for revisions.`;
```

**Step 2:** In the runner, resolve the system prompt based on session kind:

```ts
// In runner.ts, after loading the session:
const session = await ctx.repos.sessions.findById(sessionId);
// ... existing code ...

// Resolve system prompt by kind
const systemPrompt = session.kind === "intake" ? INTAKE_SYSTEM_PROMPT : undefined; // undefined = use default prompt from harness

// When building tools, add propose_session for intake sessions:
const tools = buildTools(project.cwd);
if (session.kind === "intake") {
  tools.push(createProposeSessionTool());
}
```

**Step 3:** Write test — verify intake sessions get the propose_session tool + intake prompt.

**Step 4:** Commit.

```bash
git add packages/agent/src/prompts/ apps/server/src/agent/runner.ts
git commit -m "feat(agent): intake agent system prompt + propose_session tool for intake sessions"
```

---

## Phase 5: Confirm Flow + Task Session Lifecycle

**Deliverable:** When the agent calls `propose_session`, an inline confirm card appears in the timeline. On confirm, a task session is created and the pre-filled message is sent. Task sessions appear in the sidebar.

### Task 5.1: Event reducer — detect propose_session tool calls

**Files:**

- Modify: `apps/desktop/src/stores/session/event-reducer.ts`

**Step 1:** When a tool call event comes in with `toolName === "propose_session"`, store the proposal data:

```ts
// Add to SessionStoreData:
proposedSession: { title: string; message: string } | null;

// In event-reducer, when handling tool_call_complete for propose_session:
if (toolName === "propose_session") {
  const args = parseToolArgs(input); // extract title + message from the tool input
  session.actions.setProposedSession(args);
}
```

**Step 2:** Add `setProposedSession` + `clearProposedSession` actions to `SessionActions`.

**Step 3:** Commit.

### Task 5.2: ProposedSessionCard inline confirm UI

**Files:**

- Create: `apps/desktop/src/components/chat/parts/proposed-session-card.tsx`

**Step 1:** Create the component:

```tsx
import { Show, createSignal } from "solid-js";
import type { SessionStore } from "~/stores/session/session-store";

interface Props {
  proposal: { title: string; message: string };
  sessionStore: SessionStore;
  onConfirm: (title: string, message: string) => void;
  onReject: () => void;
}

export function ProposedSessionCard(props: Props) {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div
      class="rounded-lg border border-primary/30 bg-primary/5 p-4"
      data-component="proposed-session-card"
    >
      <div class="mb-2 flex items-center gap-2">
        <span class="text-lg">{"\u{1F4CB}"}</span>
        <span class="font-semibold text-sm">Proposed Session</span>
      </div>
      <h3 class="mb-2 font-medium text-foreground">{props.proposal.title}</h3>
      <Show
        when={expanded()}
        fallback={
          <button class="text-xs text-primary hover:underline" onClick={() => setExpanded(true)}>
            Show brief →
          </button>
        }
      >
        <pre class="mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-muted-foreground">
          {props.proposal.message}
        </pre>
      </Show>
      <div class="flex gap-2">
        <button
          class="rounded-lg bg-primary px-4 py-1.5 text-primary-foreground text-sm hover:bg-primary/90"
          data-action="confirm-session"
          onClick={() => props.onConfirm(props.proposal.title, props.proposal.message)}
          type="button"
        >
          Create Session
        </button>
        <button
          class="rounded-lg border border-border px-4 py-1.5 text-muted-foreground text-sm hover:bg-muted"
          data-action="reject-session"
          onClick={props.onReject}
          type="button"
        >
          Revise
        </button>
      </div>
    </div>
  );
}
```

**Step 2:** Commit.

### Task 5.3: Integrate confirm flow into onboarding panel

**Files:**

- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx`

**Step 1:** Render the ProposedSessionCard when `proposedSession` is set:

```tsx
import { ProposedSessionCard } from "~/components/chat/parts/proposed-session-card";

// In the template, after MessageTimeline, before ChatInput:
<Show when={sessionStore()?.store.proposedSession}>
  {(proposal) => (
    <ProposedSessionCard
      proposal={proposal()}
      sessionStore={sessionStore()!}
      onConfirm={handleConfirmSession}
      onReject={() => sessionStore()!.actions.clearProposedSession()}
    />
  )}
</Show>;
```

**Step 2:** Implement the confirm handler:

```ts
const handleConfirmSession = async (title: string, message: string) => {
  const projectId = server.store.activeProjectId;
  if (!projectId || !intakeSessionId()) return;

  // Create the task session
  const taskSession = await actions.createSession(projectId, undefined, title);
  if (!taskSession) return;

  // Clear the proposal
  sessionStore()?.actions.clearProposedSession();

  // Switch tab to the new session
  setTabSession(projectId, taskSession.id);

  // Send the pre-filled message as the first prompt
  actions.sendPrompt(taskSession.id, message);
};
```

**Step 3:** Import `setTabSession` from `~/stores/workspace/tab-store`.

**Step 4:** Write test — mock propose_session event, verify card appears, click confirm, verify createSession + sendPrompt called.

**Step 5:** Commit.

```bash
git add apps/desktop/src/components/onboarding/ apps/desktop/src/components/chat/parts/proposed-session-card.tsx apps/desktop/src/stores/session/
git commit -m "feat(desktop): propose_session confirm flow with inline card + task session creation"
```

### Task 5.4: Sidebar shows task sessions

**Files:**

- Modify: `apps/desktop/src/components/layout/sidebar/sidebar.tsx`

**Step 1:** Filter sessions in the sidebar to show only `kind === "task"` (hide intake sessions):

```ts
const sessions = createMemo(() => {
  return server.store.sessionOrder
    .map((id) => server.store.sessions[id])
    .filter((s): s is SessionMeta => !!s && s.projectId === activeProjectId && s.kind === "task");
});
```

**Step 2:** Verify intake sessions don't appear in the sidebar list.

**Step 3:** Commit.

### Task 5.5: Task session chat view stub

**Files:**

- Modify: `apps/desktop/src/components/layout/workspace-layout.tsx`

**Step 1:** When a task session is active (not intake), show a task chat view. For now, this can be a minimal stub that reuses the MessageTimeline + ChatInput components:

```tsx
// Replace the "Chat view coming soon" stub:
function TaskChatView(props: { sessionId: string }) {
  const { sessionRegistry, actions } = useStore();
  const session = sessionRegistry.get(props.sessionId);

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <MessageTimeline
        turns={buildChatTurns(
          session.store.messageOrder,
          session.store.messages,
          session.store.streaming.phase,
        )}
        isStreaming={() => session.store.streaming.phase !== "idle"}
      />
      <ChatInput
        onSend={() => {
          /* sendPrompt logic */
        }}
        placeholder="Continue working..."
      />
    </div>
  );
}
```

**Step 2:** Run typecheck + tests + lint.

**Step 3:** Commit.

```bash
git add apps/desktop/src/components/layout/workspace-layout.tsx apps/desktop/src/components/layout/sidebar/sidebar.tsx
git commit -m "feat(desktop): task session view + sidebar filtering"
```

---

## Verification Checklist (after all phases)

```bash
nub run typecheck                          # all 5 packages pass
cd apps/desktop && nub run test            # all tests pass
cd packages/db && nub run test             # db tests pass
cd packages/tools && nub run test          # tool tests pass
cd apps/server && nub run test             # server tests pass
nubx ultracite fix                         # lint clean
nub run dev:server                         # manual smoke test
cd apps/desktop && nub run dev             # full app test
```

**Manual test flow:**

1. Open a project → intake session created → onboarding panel shows
2. Type a message → agent responds → messages render with markdown + tool calls
3. Change model via command center dialog → model switches
4. Continue chatting → agent calls propose_session → confirm card appears
5. Click "Create Session" → task session created → tab switches → agent starts working
6. Click "Revise" → card dismissed → continue chatting in intake
7. Close and reopen project → intake session persists → messages loaded
