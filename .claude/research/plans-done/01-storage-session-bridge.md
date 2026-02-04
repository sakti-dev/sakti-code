# Storage + Session Bridge (XState + Mastra Memory + Drizzle/libsql)

## Goal
Provide a cohesive storage strategy that:
- Keeps XState as the primary orchestrator.
- Uses Mastra Memory for semantic recall and working memory only.
- Uses Drizzle + libsql for app-owned state (sessions, tool sessions, repo cache).
- Standardizes **UUIDv7** for session and tool-session IDs.

## Core Decisions
- **sessionId**: UUIDv7 generated server-side.
- **threadId = sessionId** (Mastra Memory).
- **resourceId = userId** or **"local"** for single-user desktop mode.
- **Mastra Memory** is optional but recommended for semantic recall.
- **Drizzle/libsql** owns app tables and migrations.

## App Paths & DB URLs (Canonical)
Use a single resolved **Ekacode home** directory so server + core never diverge.

**Resolution order (self-contained):**
1) `EKACODE_HOME` (override)
2) **Dev**: repo-local `./.ekacode/` (Option A)
3) **Prod**: OS user-data directory (Electron `app.getPath("userData")` or OS defaults via `env-paths("ekacode")`)

**Directory layout:**
```
<home>/
  config/
  state/
  db/
    ekacode.db
    mastra.db
  logs/
```

**Cache + repo cache:**
- **Prod**: OS cache dir (Electron `app.getPath("cache")` or `env-paths(...).cache`)
- **Dev**: `./.ekacode/cache/`
- **Repo cache root**: `<cache>/repos/` (store repo clones/metadata here)

**DB URL requirements:**
- Use **absolute** file URLs (e.g., `file:/abs/path/ekacode.db`), never relative.
- Drizzle + Mastra Memory must use **the same resolved paths** to avoid split state.

## Placement in Current Monorepo
- `packages/server/src/db`: Drizzle client + schema + migrations config.
- `packages/server/src/storage`: session/tool-session store helpers.
- `packages/core`: agent/tool interfaces that accept storage adapters.
- `packages/shared`: shared session/tool types (optional).
- `packages/shared`: **path resolver** used by server + core to compute `home/db/cache` paths.

## Drizzle (Up-to-Date Setup)
Install:
```bash
npm i drizzle-orm @libsql/client
npm i -D drizzle-kit
```

DB client:
```ts
// packages/server/src/db/index.ts
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { resolveAppPaths } from "@ekacode/shared/paths";

const paths = resolveAppPaths();
const client = createClient({ url: paths.ekacodeDbUrl });

export const db = drizzle(client, { schema });
```

Drizzle config:
```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
import { resolveAppPaths } from "@ekacode/shared/paths";

const paths = resolveAppPaths();
export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/server/src/db/schema.ts",
  dbCredentials: { url: paths.ekacodeDbUrl },
  out: "./drizzle",
});
```

Migrations:
```bash
npx drizzle-kit generate:sqlite
npx drizzle-kit migrate
```

## App-Owned Tables (Drizzle)
```ts
// packages/server/src/db/schema.ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  resourceId: text("resource_id").notNull(),
  createdAt: integer("created_at").notNull(),
  lastAccessed: integer("last_accessed").notNull(),
});

export const toolSessions = sqliteTable(
  "tool_sessions",
  {
    sessionId: text("session_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolKey: text("tool_key"),
    toolSessionId: text("tool_session_id").notNull(),
    createdAt: integer("created_at").notNull(),
    lastAccessed: integer("last_accessed").notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.sessionId, table.toolName, table.toolKey] }),
  }),
);

export const repoCache = sqliteTable("repo_cache", {
  resourceKey: text("resource_key").primaryKey(),
  url: text("url").notNull(),
  ref: text("ref").notNull(),
  searchPath: text("search_path").notNull(),
  localPath: text("local_path").notNull(),
  commit: text("commit"),
  clonedAt: integer("cloned_at").notNull(),
  lastUpdated: integer("last_updated").notNull(),
});
```
Note: `repo_cache.localPath` should be stored under the resolved **repo cache root** (`<cache>/repos/`).

## UUIDv7 Generation
```ts
import { v7 as uuidv7 } from "uuid";

const sessionId = uuidv7();
const toolSessionId = uuidv7();
```

## Session Flow (Canonical)
1) UI sends first prompt without `sessionId`.
2) Server generates UUIDv7, inserts `sessions` row, emits `data-session` in UIMessage stream.
3) UI stores `sessionId` and includes it in future requests.
4) XState loads session + tool sessions; maintains state transitions.
5) Mastra Memory recall runs before model call; messages saved after turn.

## UIMessage Stream (Emit Session)
```ts
writer.write({
  type: "data-session",
  id: "session",
  data: { sessionId, resourceId },
});
```

## Tool Session Lookup (Drizzle)
- Keyed by `(sessionId, toolName, toolKey)`.
- `toolKey` is `resourceKey` for `search_docs`, `null` for `sequentialThinking`.
- If missing, create UUIDv7 and upsert.

## Mastra Memory (Standalone)
```ts
import { Memory } from "@mastra/memory";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { fastembed } from "@mastra/fastembed";
import { resolveAppPaths } from "@ekacode/shared/paths";

const paths = resolveAppPaths();
export const memory = new Memory({
  storage: new LibSQLStore({ id: "mastra-storage", url: paths.mastraDbUrl }),
  vector: new LibSQLVector({ id: "mastra-vector", url: paths.mastraDbUrl }),
  embedder: fastembed,
  options: {
    lastMessages: 10,
    semanticRecall: { topK: 4, messageRange: 2, scope: "thread" },
  },
});
```

### Recall
```ts
const { messages } = await memory.recall({
  threadId: sessionId,
  resourceId,
  vectorSearchString: userText,
});
```

### Save messages
```ts
await memory.saveMessages({
  messages: [
    {
      threadId: sessionId,
      resourceId,
      role: "user",
      content: { format: 2, content: userText },
      createdAt: new Date(),
    },
    {
      threadId: sessionId,
      resourceId,
      role: "assistant",
      content: { format: 2, content: assistantText },
      createdAt: new Date(),
    },
  ],
});
```

## TTL & Cleanup
- `sessions` and `tool_sessions`: TTL or LRU cleanup based on `lastAccessed`.
- `repo_cache`: independent TTL (longer), validated on startup.
- Mastra Memory handles message history; app layer handles session lifecycle.

## Notes
- Mastra Memory can be used without Mastra agent workflow.
- If you need UUIDv7 for message IDs too, provide IDs yourself or inject a custom generator.
