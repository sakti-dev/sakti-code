# Per-Session Profile Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move model selection from a global profiles.json mutation to per-session `profileId`, so each session independently controls which model/profile it uses.

**Architecture:** Sessions get a nullable `profile_id` column referencing a profile in `profiles.json`. When null, it falls back to `profiles.defaultProfile`. The server's `resolveModel()` reads `session.profileId ?? defaultProfile` — no more project-level profile indirection. The old `sessions.model_id` and `projects.profile_id` columns are dropped. The desktop `selectModel` action becomes `selectProfile` — a simple `PATCH /api/sessions/:id` with `{ profileId }`.

**Tech Stack:** Drizzle ORM + node:sqlite (DB), Hono REST (server), SolidJS stores (desktop), Vitest (testing).

---

## Key Design Decisions

1. **Per-session profiles, not per-project.** Each session picks its own profile. No project-level `profile_id`.
2. **Fallback chain is simple:** `session.profileId ?? profiles.defaultProfile`. No project middleman.
3. **`model_id` and `thinking_level` columns stay on `sessions`** as nullable cache for UI display — they're no longer the source of truth but prevent breaking existing UI components until the profile selector lands in a follow-up plan.
4. **`profile_id` dropped from `projects` table** — projects don't control model selection.
5. **`SessionRepo.create` signature changes** — `modelId` param becomes optional, new `profileId` param added.
6. **`resolveModel` signature changes** — accepts `session.profileId` directly instead of looking up `project.profileId`.
7. **`exactOptionalPropertyTypes` is on** — use conditional spreads, never pass `undefined` explicitly.

---

### Task 1: DB schema — add `profile_id` to sessions, drop `profile_id` from projects

**Files:**
- Modify: `packages/db/src/schema.ts`
- Modify: `packages/db/src/__tests__/init.test.ts`
- Create: migration via `drizzle-kit generate`

**Step 1: Update the schema**

In `packages/db/src/schema.ts`:

1. Remove `profileId` from the `projects` table (line 12):
```ts
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cwd: text("cwd").notNull().unique(),
  // REMOVED: profileId: text("profile_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

2. Make `modelId` nullable and add `profileId` to the `sessions` table (around line 25):
```ts
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle self-referencing FK needs any return type
  parentSessionId: text("parent_session_id").references((): any => sessions.id),
  title: text("title"),
  modelId: text("model_id"),  // nullable now — display cache, not source of truth
  profileId: text("profile_id"),  // NEW — references profiles.json key
  kind: text("kind").notNull().default("task"),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  leafId: text("leaf_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
```

**Step 2: Generate the migration**

```bash
cd packages/db && nub run db:generate
```

Expected: A new migration folder appears under `packages/db/migrations/` with SQL to add `profile_id` column to `sessions` and drop `profile_id` from `projects`. Also makes `model_id` nullable.

If drizzle-kit generates a SQLite table recreation (because SQLite can't ALTER COLUMN), review the SQL to ensure data is preserved.

**Step 3: Update init.test.ts**

In `packages/db/src/__tests__/init.test.ts`, update the raw INSERT statements (lines 53-58) to match the new schema:

```ts
    // profile_id removed from projects
    db.prepare(
      "INSERT INTO projects (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run("p1", "Test", "/tmp/test", 1, 1);
    db.prepare(
      "INSERT INTO sessions (id, project_id, model_id, profile_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("s1", "p1", "claude-sonnet", null, 1, 1);
```

Remove the `profile_id` assertion block (lines 63-67) that checked `projects.profile_id`:
```ts
    // REMOVED: profile_id column exists and is nullable block for projects
```

Add a check that `sessions.profile_id` exists and is nullable:
```ts
    // profile_id column on sessions exists and is nullable
    const session = db
      .prepare("SELECT profile_id FROM sessions WHERE id = ?")
      .get("s1") as { profile_id: string | null };
    expect(session.profile_id).toBeNull();
```

**Step 4: Run tests to verify**

```bash
cd packages/db && nub run test -- init
```
Expected: PASS

**Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/__tests__/init.test.ts packages/db/migrations/
git commit -m "feat(db): add profile_id to sessions, drop profile_id from projects"
```

---

### Task 2: Update SessionRepo and ProjectRepo

**Files:**
- Modify: `packages/db/src/repos/index.ts`
- Modify: `packages/db/src/repos/__tests__/repos.test.ts`

**Step 1: Write the failing tests**

Update `packages/db/src/repos/__tests__/repos.test.ts`:

1. In the `ProjectRepo` describe block, remove the `profileId` tests (lines 44-53):
```ts
  // REMOVED:
  // test("created project has null profileId", ...)
  // test("update can set profileId", ...)
```

2. Remove `profileId` from the `ProjectRepo.update` Pick assertion. The update test doesn't need profileId anymore.

3. In the `SessionRepo` describe block, add tests for the new `profileId` field:
```ts
  test("create with profileId", async () => {
    const proj = await projectRepo.create("p-prof", "/tmp/p-prof");
    const s = await repo.create(proj.id, {
      profileId: "fast",
    });
    expect(s.profileId).toBe("fast");
    expect(s.modelId).toBeNull();
  });

  test("create without profileId defaults to null", async () => {
    const proj = await projectRepo.create("p-noprof", "/tmp/p-noprof");
    const s = await repo.create(proj.id);
    expect(s.profileId).toBeNull();
  });

  test("update can set profileId", async () => {
    const proj = await projectRepo.create("p-upd", "/tmp/p-upd");
    const s = await repo.create(proj.id);
    const updated = await repo.update(s.id, { profileId: "balanced" });
    expect(updated.profileId).toBe("balanced");
  });

  test("update can clear profileId", async () => {
    const proj = await projectRepo.create("p-clear", "/tmp/p-clear");
    const s = await repo.create(proj.id, { profileId: "fast" });
    const updated = await repo.update(s.id, { profileId: null });
    expect(updated.profileId).toBeNull();
  });
```

4. Update the existing create test (lines 75-89) to use the new signature:
```ts
  test("create + findById + listByProject", async () => {
    const proj = await projectRepo.create("p", "/tmp/p");
    const s = await repo.create(proj.id, { title: "First session" });
    expect(s.id).toBeDefined();
    expect(s.modelId).toBeNull();
    expect(s.title).toBe("First session");

    const found = repo.findById(s.id);
    expect(found?.id).toBe(s.id);

    const list = repo.listByProject(proj.id);
    expect(list.length).toBe(1);
  });
```

**Step 2: Run tests to verify they fail**

```bash
cd packages/db && nub run test -- repos.test
```
Expected: FAIL — `SessionRepo.create` signature doesn't match, `profileId` not in update Pick.

**Step 3: Update ProjectRepo**

In `packages/db/src/repos/index.ts`, update `ProjectRepo.update` (line 40-55) — remove `profileId` from the Pick:

```ts
  async update(
    id: string,
    data: Partial<
      Pick<typeof projects.$inferInsert, "name" | "cwd">
    >
  ) {
```

**Step 4: Update SessionRepo**

In `packages/db/src/repos/index.ts`, update `SessionRepo.create` (lines 68-98):

```ts
  async create(
    projectId: string,
    options?: {
      title?: string;
      modelId?: string;
      profileId?: string | null;
      thinkingLevel?: string;
      parentSessionId?: string;
      kind?: string;
    }
  ) {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db.insert(sessions).values({
      id,
      projectId,
      ...(options?.parentSessionId === undefined
        ? {}
        : { parentSessionId: options.parentSessionId }),
      title: options?.title ?? null,
      ...(options?.modelId === undefined ? {} : { modelId: options.modelId }),
      ...(options?.profileId === undefined ? {} : { profileId: options.profileId }),
      kind: options?.kind ?? "task",
      thinkingLevel: options?.thinkingLevel ?? "off",
      createdAt: now,
      updatedAt: now,
    });
    const created = this.findById(id);
    if (!created) {
      throw new Error(`Not found after write: ${id}`);
    }
    return created;
  }
```

Update `SessionRepo.update` (lines 123-141) — replace `modelId`/`thinkingLevel` Pick with `profileId`:

```ts
  async update(
    id: string,
    data: Partial<
      Pick<
        typeof sessions.$inferInsert,
        "title" | "modelId" | "thinkingLevel" | "kind" | "profileId"
      >
    >
  ) {
```

**Step 5: Run tests to verify they pass**

```bash
cd packages/db && nub run test
```
Expected: ALL PASS

**Step 6: Commit**

```bash
git add packages/db/src/repos/index.ts packages/db/src/repos/__tests__/repos.test.ts
git commit -m "feat(db): update SessionRepo for per-session profileId"
```

---

### Task 3: Update profile-resolver — accept session-level profileId

**Files:**
- Modify: `apps/server/src/lib/profile-resolver.ts` (no change needed — already accepts `profileId: string | null`)
- Modify: `apps/server/src/lib/__tests__/profile-resolver.test.ts` (no change needed — already tests this)

**Step 1: Verify existing tests pass**

The `resolveModelRef` function already accepts `profileId: string | null` and falls back to `profiles.defaultProfile`. No changes needed here.

```bash
cd apps/server && nub run test -- profile-resolver
```
Expected: PASS (no changes needed)

---

### Task 4: Update resolveModel — use session.profileId, drop project lookup

**Files:**
- Modify: `apps/server/src/agent/model-resolver.ts`
- Modify: `apps/server/src/agent/__tests__/model-resolver.test.ts`
- Modify: `apps/server/src/agent/__tests__/helpers.ts`

**Step 1: Write the failing tests**

Update `apps/server/src/agent/__tests__/model-resolver.test.ts`:

1. Change the `makeCtx` function to accept a `session` object with `profileId` instead of a `project` with `profileId`:

```ts
function makeCtx(
  profilesMock: ReturnType<typeof makeProfilesMock>,
  session: { projectId: string; profileId: string | null } | null,
  auth?: { getApiKey: (provider: string) => string | undefined }
) {
  return {
    auth: auth ?? { getApiKey: () => undefined },
    profiles: profilesMock,
    repos: {
      projects: {
        findById: vi.fn((id: string) =>
          session && session.projectId === id
            ? { id, name: "test", cwd: "/tmp", createdAt: 0, updatedAt: 0 }
            : null
        ),
      },
      sessions: {
        findById: vi.fn(() =>
          session
            ? {
                id: "sess-1",
                projectId: session.projectId,
                profileId: session.profileId,
                modelId: null,
                title: null,
                thinkingLevel: "off",
                kind: "task",
                createdAt: 0,
                updatedAt: 0,
              }
            : null
        ),
      },
    },
  } as any;
}
```

2. Change all `resolveModel(ctx, { projectId: "proj-1" })` calls to `resolveModel(ctx, { id: "sess-1", projectId: "proj-1" })`. The function now needs the session's `profileId`, so it takes a session-like object.

3. Update the "resolves via project.profileId override" test (line 81) to "resolves via session.profileId override":
```ts
    it("resolves via session.profileId override", () => {
      // ... same profiles setup ...
      const ctx = makeCtx(profilesMock, {
        projectId: "proj-1",
        profileId: "fast",  // session-level override
      });

      const result = resolveModel(ctx, { id: "sess-1", projectId: "proj-1" });

      expect(result.provider).toBe("groq");
      expect(result.modelId).toBe("llama-3.1-8b-instant");
    });
```

4. Update all other tests similarly — `profileId: null` on sessions instead of projects.

**Step 2: Run tests to verify they fail**

```bash
cd apps/server && nub run test -- model-resolver
```
Expected: FAIL — `resolveModel` still looks up `project.profileId`.

**Step 3: Update resolveModel**

In `apps/server/src/agent/model-resolver.ts`, change `resolveModel` (lines 52-69):

```ts
export function resolveModel(
  ctx: ServerContext,
  session: { id: string; projectId: string; profileId: string | null }
): ResolvedModel {
  const profiles = getCachedProfiles(ctx);
  const ref = resolveModelRef(profiles, session.profileId, "default");
  return {
    model: resolveModelInstance(ref.provider as KnownProvider, ref.model),
    modelId: ref.model,
    provider: ref.provider,
    thinkingLevel: ref.thinkingLevel,
  };
}
```

Key changes:
- **Removed** `ctx.repos.projects.findById` lookup — no longer needed
- **Uses** `session.profileId` directly instead of `project.profileId`
- **Accepts** the full session object (with `id`, `projectId`, `profileId`)

Also update `resolveAuth` (lines 71-81) to pass through the same session shape:

```ts
export function resolveAuth(
  ctx: ServerContext,
  session: { id: string; projectId: string; profileId: string | null }
): ResolvedAuth | undefined {
  const resolved = resolveModel(ctx, session);
  const apiKey = ctx.auth.getApiKey(resolved.provider);
  if (!apiKey) {
    return;
  }
  return { ...resolved, apiKey };
}
```

**Step 4: Update mock helpers**

In `apps/server/src/agent/__tests__/helpers.ts`:

1. `createMockCtx` — update the mock session (lines 62-73) to include `profileId`:
```ts
      sessions: {
        findById: vi.fn(async (id: string) =>
          id === "sess-1"
            ? {
                id: "sess-1",
                projectId,
                profileId: overrides?.profileId ?? null,
                modelId: null,
                title: null,
                thinkingLevel: "off",
                kind: "task",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
```

Change the `createMockCtx` overrides type from `profileId?: string | null` (which was for the project) to still work — it now sets the session's `profileId`.

2. Remove `profileId` from the mock project (lines 77-88):
```ts
      projects: {
        findById: vi.fn(async (id: string) =>
          id === projectId
            ? {
                id: projectId,
                name: "test-project",
                cwd: "/tmp/test",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            : null
        ),
      },
```

3. `createMultiSessionCtx` — update mock sessions (lines 169-180) to include `profileId: null`:
```ts
        sessions: {
          findById: vi.fn(async (id: string) =>
            sessionIdToProjectId[id]
              ? {
                  id,
                  projectId: sessionIdToProjectId[id],
                  profileId: null,
                  modelId: null,
                  title: null,
                  thinkingLevel: "off",
                  kind: "task",
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }
              : null
          ),
        },
```

Remove `profileId` from mock projects (lines 117-139).

**Step 5: Run tests to verify they pass**

```bash
cd apps/server && nub run test -- model-resolver
```
Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/agent/model-resolver.ts apps/server/src/agent/__tests__/model-resolver.test.ts apps/server/src/agent/__tests__/helpers.ts
git commit -m "feat(server): resolveModel uses session.profileId"
```

---

### Task 5: Update runner.ts — pass session to resolveModel/resolveAuth

**Files:**
- Modify: `apps/server/src/agent/runner.ts`

**Step 1: Update runPrompt**

In `apps/server/src/agent/runner.ts`, the `runPrompt` function (lines 194-261) currently calls:

```ts
const auth = resolveAuth(ctx, session);
```

Where `session` is the DB row. Now `resolveAuth` expects `{ id, projectId, profileId }`. The DB session row already has these fields after Task 2. Verify the `findById` return includes `profileId`.

Update line 211:
```ts
  const auth = resolveAuth(ctx, session);
```

This should work as-is if `session` has `profileId` from the DB row. But also update the error message line (line 214) which calls `resolveModel`:

```ts
  if (!auth) {
    const resolved = resolveModel(ctx, session);
    throw new Error(
      `No API key for ${resolved.provider} in env`
    );
  }
```

No signature change needed — `session` already has `id`, `projectId`, and `profileId` from the DB.

**Step 2: Verify resolveThinkingLevel still works**

`resolveThinkingLevel` (lines 174-192) reads from per-session settings and falls back to `session.thinkingLevel`. This doesn't need changes — `thinkingLevel` column stays.

**Step 3: Run tests**

```bash
cd apps/server && nub run test -- runner
```
Expected: PASS

**Step 4: Commit**

```bash
git add apps/server/src/agent/runner.ts
git commit -m "refactor(server): runner passes session to resolveAuth"
```

---

### Task 6: Update session routes — POST and PATCH

**Files:**
- Modify: `apps/server/src/routes/sessions/sessions.ts`
- Modify: `apps/server/src/__tests__/sessions.test.ts`

**Step 1: Write the failing tests**

Update `apps/server/src/__tests__/sessions.test.ts`:

1. Change the POST test to not pass `modelId`:
```ts
  it("creates a session under a project and lists it", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const created = await app.request(
      new Request("http://localhost:3001/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      })
    );
    expect(created.status).toBe(200);
    const session = await created.json();
    expect(session.projectId).toBe(project.id);
    expect(session.profileId).toBeNull();

    const list = await (
      await app.request(
        new Request(
          `http://localhost:3001/api/sessions?projectId=${project.id}`
        )
      )
    ).json();
    expect(list).toHaveLength(1);
  });
```

2. Add a test for PATCH with profileId:
```ts
  it("PATCH /api/sessions/:id updates profileId", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo-patch");
    const session = await ctx.repos.sessions.create(project.id);

    const res = await app.request(
      new Request(`http://localhost:3001/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: "fast" }),
      })
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.profileId).toBe("fast");
  });
```

3. Update the messages test to use the new create signature:
```ts
  it("GET /api/sessions/:id/messages returns history (empty initially)", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, sessionsRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");
    const session = await ctx.repos.sessions.create(project.id);
    // ... rest unchanged
  });
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/server && nub run test -- sessions.test
```
Expected: FAIL — POST route still requires/expects `modelId`, PATCH doesn't accept `profileId`.

**Step 3: Update POST route**

In `apps/server/src/routes/sessions/sessions.ts`, update the POST handler (lines 24-75):

```ts
  .post(
    "/",
    tbValidator(
      "json",
      Type.Object({
        projectId: Type.String(),
        title: Type.Optional(Type.String()),
        kind: Type.Optional(Type.String()),
        parentSessionId: Type.Optional(Type.String()),
        profileId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      })
    ),
    async (c) => {
      const ctx = getCtx(c);
      const body = c.req.valid("json");

      const created = await ctx.repos.sessions.create(body.projectId, {
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.parentSessionId === undefined
          ? {}
          : { parentSessionId: body.parentSessionId }),
        ...(body.profileId === undefined ? {} : { profileId: body.profileId }),
      });
      return c.json(created);
    }
  )
```

Key changes:
- **Removed** `modelId` from body schema
- **Removed** the entire profile-resolution-on-create block (lines 40-64) — session starts with `profileId: null`, falls back to `defaultProfile` at runtime
- **Added** optional `profileId` to body

**Step 4: Update PATCH route**

In the same file, update the PATCH handler (lines 77-96):

```ts
  .patch(
    "/:id",
    tbValidator(
      "json",
      Type.Partial(
        Type.Object({
          title: Type.Union([Type.String(), Type.Null()]),
          profileId: Type.Union([Type.String(), Type.Null()]),
          thinkingLevel: Type.String(),
        })
      )
    ),
    async (c) =>
      c.json(
        await getCtx(c).repos.sessions.update(
          c.req.param("id"),
          c.req.valid("json")
        )
      )
  )
```

Key changes:
- **Replaced** `modelId` with `profileId` in the schema
- `thinkingLevel` stays (used by per-session thinking selector UI)

**Step 5: Run tests to verify they pass**

```bash
cd apps/server && nub run test -- sessions.test
```
Expected: PASS

**Step 6: Commit**

```bash
git add apps/server/src/routes/sessions/sessions.ts apps/server/src/__tests__/sessions.test.ts
git commit -m "feat(server): session routes accept profileId"
```

---

### Task 7: Update intake-session route

**Files:**
- Modify: `apps/server/src/routes/projects/intake-session.ts`
- Modify: `apps/server/src/__tests__/intake-session.test.ts`

**Step 1: Update tests**

In `apps/server/src/__tests__/intake-session.test.ts`, update the "empty modelId" test (lines 53-69):

```ts
  it("creates session with null profileId when no profile is configured", async () => {
    const { app, ctx } = await makeApp([projectsRoutes, intakeSessionRoutes]);
    const project = await ctx.repos.projects.create("demo", "/tmp/demo");

    const res = await app.request(
      new Request(
        `http://localhost:3001/api/projects/${project.id}/intake-session`,
        {
          method: "POST",
        }
      )
    );
    expect(res.status).toBe(201);
    const session = await res.json();
    expect(session.kind).toBe("intake");
    expect(session.profileId).toBeNull();
  });
```

The first test (lines 7-37) should keep working — it seeds a profile and creates an intake session. Remove the `modelId`/`thinkingLevel` resolution expectations.

**Step 2: Run tests to verify they fail**

```bash
cd apps/server && nub run test -- intake-session
```
Expected: FAIL — route still resolves modelId from profiles.

**Step 3: Update the route**

In `apps/server/src/routes/projects/intake-session.ts`, simplify (remove profile resolution):

```ts
import { Hono } from "hono";
import { getCtx } from "../../context.ts";

export const intakeSessionRoutes = new Hono()
  .basePath("/projects")
  .post("/:id/intake-session", async (c) => {
    const ctx = getCtx(c);
    const projectId = c.req.param("id");

    const project = ctx.repos.projects.findById(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const existing = ctx.repos.sessions.findIntakeByProject(projectId);
    if (existing) {
      return c.json(existing);
    }

    const created = await ctx.repos.sessions.create(projectId, {
      kind: "intake",
      title: "Intake",
    });
    return c.json(created, 201);
  });
```

Key changes:
- **Removed** `resolveModelRef` import and usage
- **Removed** `ctx.profiles.read()` call
- **Removed** `modelId`/`thinkingLevel` resolution — session starts with `profileId: null`

**Step 4: Run tests to verify they pass**

```bash
cd apps/server && nub run test -- intake-session
```
Expected: PASS

**Step 5: Commit**

```bash
git add apps/server/src/routes/projects/intake-session.ts apps/server/src/__tests__/intake-session.test.ts
git commit -m "refactor(server): intake session no longer resolves model on create"
```

---

### Task 8: Update fork route

**Files:**
- Modify: `apps/server/src/routes/sessions/forking.ts`

**Step 1: Update the fork handler**

In `apps/server/src/routes/sessions/forking.ts`, update the fork POST (lines 33-41). The `SessionRepo.create` signature changed — `modelId` is no longer a positional arg:

```ts
    const newSession = await ctx.repos.sessions.create(
      session.projectId,
      {
        title: forkedTitle,
        parentSessionId: id,
        ...(session.profileId === null ? {} : { profileId: session.profileId }),
        ...(session.modelId === null || session.modelId === undefined
          ? {}
          : { modelId: session.modelId }),
        thinkingLevel: session.thinkingLevel,
      }
    );
```

**Step 2: Run tests**

```bash
cd apps/server && nub run test -- fork
```
Expected: PASS

**Step 3: Commit**

```bash
git add apps/server/src/routes/sessions/forking.ts
git commit -m "refactor(server): fork copies session.profileId"
```

---

### Task 9: Update compaction route (resolveModel call)

**Files:**
- Modify: `apps/server/src/routes/sessions/compaction.ts`

**Step 1: Check the resolveModel call**

In `apps/server/src/routes/sessions/compaction.ts`, the `resolveModel(ctx, session)` call (around line 24) now requires the session object to have `profileId`. The `session` from `findById` will have `profileId` from the DB, so this should work as-is.

Verify by running:
```bash
cd apps/server && nub run test -- compaction
```

If tests pass, skip to commit. If they fail, update the mock session in compaction tests to include `profileId: null`.

**Step 2: Commit (if changed)**

```bash
git add apps/server/src/routes/sessions/compaction.ts
git commit -m "refactor(server): compaction uses session.profileId"
```

---

### Task 10: Update desktop store types — SessionMeta

**Files:**
- Modify: `apps/desktop/src/stores/server/server-store.ts`

**Step 1: Update SessionMeta**

In `apps/desktop/src/stores/server/server-store.ts`, update the `SessionMeta` interface (lines 11-20):

```ts
export interface SessionMeta {
  createdAt: number;
  id: string;
  kind: "intake" | "task";
  modelId: string | null;  // nullable now — display cache
  profileId: string | null;  // NEW
  projectId: string;
  thinkingLevel: string;
  title: string | null;
  updatedAt: number;
}
```

Also update the `Project` interface (lines 3-9) — remove any `profileId` if present (it's not currently there, so just verify).

**Step 2: Run typecheck to find all breakages**

```bash
cd apps/desktop && nub run typecheck 2>&1 | head -40
```

This will reveal all places that need updating — they'll be fixed in subsequent tasks.

**Step 3: Commit (type errors are expected — subsequent tasks fix them)**

Do NOT commit yet — wait until all type errors are resolved.

---

### Task 11: Update desktop actions — selectModel → selectProfile

**Files:**
- Modify: `apps/desktop/src/stores/server/actions.ts`
- Modify: `apps/desktop/src/stores/server/__tests__/actions.test.ts`

**Step 1: Write the failing tests**

Update `apps/desktop/src/stores/server/__tests__/actions.test.ts`:

1. Replace the `selectModel` describe block (lines 195+) with `selectProfile`:

```ts
  describe("selectProfile", () => {
    it("PATCHes session profileId on server", async () => {
      const { actions, api, deps } = makeActions();
      vi.mocked(api.api.sessions[":id"].$patch).mockResolvedValue(
        new Response(JSON.stringify({
          ...deps.serverStore.store.sessions.s1!,
          profileId: "fast",
        }), { status: 200 })
      );

      await actions.selectProfile("s1", "fast");

      expect(api.api.sessions[":id"].$patch).toHaveBeenCalledWith({
        param: { id: "s1" },
        json: { profileId: "fast" },
      });
      expect(deps.serverStore.store.sessions.s1?.profileId).toBe("fast");
    });

    it("does nothing when sessionId is null", async () => {
      const { actions, api } = makeActions();
      await actions.selectProfile(null, "fast");
      expect(api.api.sessions[":id"].$patch).not.toHaveBeenCalled();
    });
  });
```

2. Remove the old `selectModel` tests entirely.

3. Update `createSession` tests to not pass `modelId`:
```ts
    it("creates a session", async () => {
      const { actions, api, deps } = makeActions();
      vi.mocked(api.api.sessions.$post).mockResolvedValue(
        new Response(JSON.stringify({
          id: "new-session",
          projectId: "p1",
          profileId: null,
          modelId: null,
          // ... other fields
        }), { status: 200 })
      );

      const result = await actions.createSession("p1");
      expect(result).toBeDefined();
      expect(api.api.sessions.$post).toHaveBeenCalledWith({
        json: { projectId: "p1" },
      });
    });
```

**Step 2: Run tests to verify they fail**

```bash
cd apps/desktop && nub run test -- actions.test
```
Expected: FAIL — `selectProfile` doesn't exist.

**Step 3: Update the Actions interface**

In `apps/desktop/src/stores/server/actions.ts`, update the `Actions` interface (lines 22-46):

Replace:
```ts
  selectModel: (
    sessionId: string | null,
    provider: string,
    model: string
  ) => Promise<void>;
```

With:
```ts
  selectProfile: (
    sessionId: string | null,
    profileId: string
  ) => Promise<void>;
```

Update `createSession` signature:
```ts
  createSession: (
    projectId: string,
    title?: string
  ) => Promise<SessionMeta | undefined>;
```

**Step 4: Update createSession implementation**

In the same file, update `createSession` (lines 101-121):

```ts
    async createSession(projectId, title) {
      try {
        const res = await api.api.sessions.$post({
          json: {
            projectId,
            ...(title === undefined ? {} : { title }),
          },
        });
        if (!res.ok) {
          return;
        }
        const session = (await res.json()) as SessionMeta;
        server.actions.addSession(session);
        return session;
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : "Failed to create session"
        );
      }
    },
```

**Step 5: Replace selectModel with selectProfile**

In the same file, replace the entire `selectModel` implementation (lines 203-253) with:

```ts
    async selectProfile(sessionId, profileId) {
      if (!sessionId) {
        return;
      }
      try {
        const res = await api.api.sessions[":id"].$patch({
          param: { id: sessionId },
          json: { profileId },
        });
        if (!res.ok) {
          return;
        }
        const updated = (await res.json()) as SessionMeta;
        server.actions.updateSession(sessionId, {
          profileId: updated.profileId,
        });
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : "Failed to select profile"
        );
      }
    },
```

**Step 6: Update test fixtures**

Update all `SessionMeta` fixtures in test files to include `profileId: null` and make `modelId` nullable. Files to update:
- `apps/desktop/src/stores/server/__tests__/server-store.test.ts`
- `apps/desktop/src/stores/server/__tests__/actions.test.ts`
- `apps/desktop/src/components/__tests__/project-group.test.tsx`
- `apps/desktop/src/components/__tests__/project-card.test.tsx`
- `apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx`

Add `profileId: null` to every `SessionMeta` literal. Change `modelId: "gpt-4"` to `modelId: "gpt-4"` (keep as string — it's `string | null` now, existing strings still work).

**Step 7: Run tests to verify they pass**

```bash
cd apps/desktop && nub run test -- actions.test
```
Expected: PASS

**Step 8: Commit**

```bash
git add apps/desktop/src/stores/server/actions.ts apps/desktop/src/stores/server/__tests__/actions.test.ts apps/desktop/src/stores/server/__tests__/server-store.test.ts apps/desktop/src/components/__tests__/project-group.test.tsx apps/desktop/src/components/__tests__/project-card.test.tsx apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx
git commit -m "feat(desktop): replace selectModel with selectProfile"
```

---

### Task 12: Update remaining desktop callers

**Files:**
- Modify: `apps/desktop/src/components/chat-input/model-selector-button.tsx`
- Modify: `apps/desktop/src/components/layout/toolbar/model-selector.tsx`
- Modify: `apps/desktop/src/components/onboarding/onboarding-panel.tsx`
- Modify: `apps/desktop/src/components/layout/sidebar/project-group.tsx`

These files read `session.modelId` for display. Since `modelId` is now `string | null` (nullable cache), they need null-safety. The actual profile selector UI is a follow-up plan — for now just make them not crash.

**Step 1: model-selector-button.tsx**

In `apps/desktop/src/components/chat-input/model-selector-button.tsx`, update `modelLabel()` (lines 128-140):

```ts
  const modelLabel = () => {
    const s = session();
    if (!s?.modelId) {
      return "Select profile";
    }
    const found = modelOptions().find((m) => m.id === s.modelId);
    return found ? (found.name ?? found.id) : s.modelId;
  };
```

Change `handleSelect` (lines 142-149) to call `selectProfile` instead of `selectModel`. For now, it still picks a model — but in the follow-up UI plan this becomes a profile picker. Keep it working:

```ts
  const handleSelect = async (modelId: string, providerId: string) => {
    // TODO: replace with profile selector in follow-up plan
    // For now this is a no-op — selectModel is removed
    log.debug("handleSelect", { modelId, providerId, sessionId: props.sessionId });
  };
```

Remove the `actions.selectModel` import — it no longer exists.

**Step 2: model-selector.tsx**

In `apps/desktop/src/components/layout/toolbar/model-selector.tsx`, update `session.modelId` reads to handle null:

```ts
    const modelId = activeSession()?.modelId;
    if (!modelId) {
      return "Select profile";
    }
```

**Step 3: onboarding-panel.tsx**

In `apps/desktop/src/components/onboarding/onboarding-panel.tsx` (line 50), handle null:

```ts
    const modelId = server.store.sessions[props.intakeSessionId]?.modelId ?? null;
```

**Step 4: project-group.tsx**

In `apps/desktop/src/components/layout/sidebar/project-group.tsx`, update the local type (lines 8-10):

```ts
  modelId: string | null;
  profileId: string | null;
```

**Step 5: Run typecheck + tests**

```bash
cd apps/desktop && nub run typecheck && nub run test
```
Expected: ALL PASS

**Step 6: Commit**

```bash
git add apps/desktop/src/components/chat-input/model-selector-button.tsx apps/desktop/src/components/layout/toolbar/model-selector.tsx apps/desktop/src/components/onboarding/onboarding-panel.tsx apps/desktop/src/components/layout/sidebar/project-group.tsx
git commit -m "fix(desktop): handle nullable modelId, wire selectProfile"
```

---

### Task 13: Full typecheck + all tests

**Step 1: Typecheck all packages**

```bash
nub run typecheck
```
Expected: PASS (all packages)

**Step 2: Run all tests**

```bash
cd packages/db && nub run test
cd packages/agent && nub run test
cd packages/tools && nub run test
cd apps/server && nub run test
cd apps/desktop && nub run test
```
Expected: ALL PASS

**Step 3: Format + lint**

```bash
nubx ultracite fix
```

**Step 4: Final commit if anything changed**

```bash
git add -A
git commit -m "chore: format and lint"
```

---

## Summary

| Task | Package | What |
|------|---------|------|
| 1 | db | Add `profile_id` to sessions, drop from projects, generate migration |
| 2 | db | Update SessionRepo/ProjectRepo signatures |
| 3 | server | Verify profile-resolver unchanged (already works) |
| 4 | server | resolveModel uses `session.profileId` instead of `project.profileId` |
| 5 | server | Runner passes session to resolveAuth |
| 6 | server | Session POST/PATCH routes accept profileId |
| 7 | server | Intake session no longer resolves model on create |
| 8 | server | Fork copies session.profileId |
| 9 | server | Compaction route verification |
| 10 | desktop | SessionMeta type: add profileId, modelId nullable |
| 11 | desktop | Replace selectModel → selectProfile action |
| 12 | desktop | Handle nullable modelId in UI components |
| 13 | all | Final verification |

## What's NOT in this plan (follow-up)

- Profile selector UI (replace model picker with profile picker)
- Settings form for managing profiles (`models-settings.tsx`)
- Dropping `model_id`/`thinking_level` columns entirely (kept as nullable cache)
- Thinking level selector wiring to profiles
