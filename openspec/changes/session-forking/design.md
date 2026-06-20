## Context

The session store (`SqliteSessionStore`) persists messages to SQLite via `MessageRepo`. Currently, all sessions are independent — there is no relationship tracking between sessions and no mechanism to duplicate a conversation up to a point and continue from there.

The existing DB schema has:
- `sessions` table with `id`, `projectId`, `title`, `modelId`, `thinkingLevel`, timestamps
- `messages` table with `id`, `sessionId`, `role`, `content`, tool metadata, `createdAt`
- `MessageRepo.copyToSession` does not exist yet — bulk copy requires a new method

Pibun implements session forking via Pi RPC commands (`session.fork`, `session.getForkMessages`) that Pi handles internally. Since sakti-code owns the persistence layer, we implement forking directly at the store level — no agent loop changes needed.

For HTML export, pibun delegates to Pi's `export_html` RPC. Since we own the messages, we can generate the HTML server-side using a template.

## Goals / Non-Goals

**Goals:**
- Add `parentSessionId` column to the `sessions` table (nullable FK to `sessions.id`)
- Add `SessionRepo.findForkedChildren(parentId)` for querying the fork tree
- Add `SqliteSessionStore.fork(sourceSessionId, upToMessageIndex?): Promise<{ sessionId: string }>` that copies messages atomically
- Add `POST /api/sessions/:id/fork` with optional `{ messageIndex }` body
- Add `GET /api/sessions/:id/fork-messages` returning eligible forkable messages (user + assistant message pairs with entry IDs and text previews)
- Add `PATCH /api/sessions/:id/name` for setting session title
- Add `GET /api/sessions/:id/export-html` returning a self-contained HTML conversation export
- Route composition — no `apps/server/src/index.ts` edits

**Non-Goals:**
- Agent-loop-level forking (forking within an active stream) — store-level is sufficient for v1
- Fork tree visualization in the API — `parentSessionId` is stored; any visualization is a future concern
- Rich HTML export templates (custom CSS, themes) — simple clean template for v1
- Exporting multiple sessions at once

## Decisions

### 1. Store-level forking via SQL bulk copy

**Decision:** `SqliteSessionStore.fork(sourceSessionId, upToMessageIndex?)` copies messages from the source session to a new session using a single `INSERT ... SELECT` SQL statement. This avoids loading thousands of messages into application memory.

```sql
-- Fork: copy messages up to (and including) messageIndex into new session
INSERT INTO messages (id, session_id, role, content, tool_calls, tool_call_id,
                      tool_name, tool_arguments, is_error, usage, created_at)
SELECT
  gen_random_uuid(),
  :newSessionId,
  role, content, tool_calls, tool_call_id,
  tool_name, tool_arguments, is_error, usage, :now
FROM messages
WHERE session_id = :sourceSessionId
  AND created_at <= (
    SELECT created_at FROM messages
    WHERE session_id = :sourceSessionId
    ORDER BY created_at
    LIMIT 1 OFFSET :messageIndex
  )
ORDER BY created_at;
```

**Alternative considered:** load all messages in app code, slice the array, insert one by one. **Rejected:** for sessions with 1000+ messages, this means loading all of them into a JavaScript array, serializing/deserializing JSON for each, and issuing individual `INSERT` statements. A single SQL statement is O(n) at the database instead of O(n) at the application + wire.

**Note on messageIndex:** the `messageIndex` refers to the 0-based index in the loaded messages array (sorted by `created_at`). The SQL uses `OFFSET :messageIndex` to find the cutoff point. If no `messageIndex` is provided, ALL messages are copied (full fork).

### 2. Forkable messages endpoint returns simplified list

**Decision:** `GET /api/sessions/:id/fork-messages` returns an array of `{ messageIndex, role, textPreview }` for user and assistant messages (skipping tool results). The messageIndex is the 0-based index in the full messages array.

```json
[
  { "messageIndex": 0, "role": "user", "textPreview": "Help me build a React..." },
  { "messageIndex": 1, "role": "assistant", "textPreview": "I'll help you build..." },
  { "messageIndex": 2, "role": "user", "textPreview": "Now add tests..." }
]
```

**Rationale:** the UI needs to show a fork point picker — each forkable message is a checkpoint the user can fork from. Tool results are not forkable because they're always paired with the assistant message that triggered them.

### 3. Dedicated naming route

**Decision:** `PATCH /api/sessions/:id/name` with body `{ title: string }` — a focused endpoint that only updates the session title. This is distinct from the generic `PATCH /api/sessions/:id` which accepts `{ title?, modelId?, thinkingLevel? }`.

**Rationale:** a dedicated route is clearer for API consumers and avoids the ambiguity of "patch the session vs. patch the settings." It also mirrors pibun's `session.setName`.

### 4. HTML export via server-side template

**Decision:** `GET /api/sessions/:id/export-html` loads the session's messages and renders them into a self-contained HTML template with inline CSS. No external dependencies, no build step.

The template SHALL include:
- Session title as `<h1>`
- Each message rendered as a chat bubble (role-colored)
- Tool results collapsed by default with an expand toggle
- `Copy` button on each assistant message
- Timestamp display
- Basic responsive CSS inline in a `<style>` tag

**Rationale:** pibun delegates export to Pi's RPC. Since sakti-code owns the messages, generating HTML server-side is straightforward and doesn't require a subprocess.

**Alternative considered:** client-side export in the app. **Rejected:** export should work from any HTTP client (curl, API consumers), not just the app UI.

### 5. Fork creates new session with same model config

**Decision:** the forked session copies `modelId`, `projectId`, and `thinkingLevel` from the source session. The new session gets `parentSessionId = sourceSessionId`, a fresh `createdAt`/`updatedAt`, and `title = "Fork of <source title>"`.

**Rationale:** the user is forking to continue the conversation with the same model and project. Starting with the same config is the expected behavior.

## Risks / Trade-offs

- **[SQL bulk copy is DB-dependent]** the `INSERT ... SELECT` syntax is standard SQL, but the `gen_random_uuid()` function may differ across SQLite versions. **Mitigation:** use `lower(hex(randomblob(16)))` which is standard in bun:sqlite's SQLite build.
- **[Fork at messageIndex boundary]** if messages have been compacted, the available indices may be fewer than expected. **Accepted:** the fork-messages endpoint returns the actual messages; the client picks from what's available.
- **[Export HTML size]** a session with 500+ messages could produce a very large HTML file. **Mitigation:** no explicit limit for v1; the export is a single GET request, so streaming is not needed. If size becomes a problem, add pagination or truncation later.
- **[No concurrent fork protection]** two fork requests for the same session at the same time could see race conditions. **Mitigation:** the fork operation is a single transaction (INSERT + SELECT in one go); SQLite's serialized isolation handles this.
