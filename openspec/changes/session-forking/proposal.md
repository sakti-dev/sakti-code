## Why

Users frequently want to explore alternative paths from a previous point in the conversation — "try a different prompt here," "go back to before that tool call and try a different approach," or "create a new session seeded from an old checkpoint." Pibun supports this via `session.fork` and `session.getForkMessages`. Sakti-code currently has no way to do this. The only option is to create a brand new session from scratch, losing all prior context.

Additionally, session naming is currently bundled into the generic `PATCH /api/sessions/:id` route. A dedicated naming route is a cleaner UX. And HTML export (`session.exportHtml` in pibun) gives users a way to share conversations outside the app.

## What Changes

### Additions

- **Add `parentSessionId` column** to the sessions table — nullable, references `sessions.id`, enables fork-tree visualization
- **Store-level session forking** — `SqliteSessionStore.fork(sourceSessionId, upToMessageIndex?)` copies messages from a source session into a new session, preserving the conversation up to the specified point
- **Fork REST route** — `POST /api/sessions/:id/fork` with optional `{ messageIndex }` body, returns the new session
- **ForkMessages REST route** — `GET /api/sessions/:id/fork-messages` returns messages eligible for forking (simplified: user + assistant pairs with entry IDs)
- **Session naming route** — `PATCH /api/sessions/:id/name` as a dedicated route (separate from the generic `PATCH /api/sessions/:id` patch)
- **HTML export route** — `GET /api/sessions/:id/export-html` (or `POST` for server-side generation) returns a self-contained HTML file of the conversation
- **WS protocol messages** — `fork`, `getForkMessages` message types for real-time clients

### No Breaking Changes

The `parentSessionId` column is nullable and defaults to null. All existing sessions continue to work. The `SessionRepo.create` method gains an optional `parentSessionId` parameter. All existing routes are unchanged.

## Capabilities

### New Capabilities

- **session-forking**: Users can fork a session at any message boundary, creating a new session seeded with the conversation up to that point
- **session-naming**: Users can set a session's display name via a dedicated endpoint
- **session-export**: Users can export a session as a self-contained HTML file

### Modified Capabilities

- **database-schema**: The sessions table gains a `parentSessionId` column
- **session-store-sqlite**: `SqliteSessionStore` gains a `fork` method
- **session-utils (stats)**: Forked sessions may show a `parentSessionId` in their stats response

## Impact

### Packages

- **`packages/db`** — schema migration adds `parentSessionId` column; `SessionRepo.create` optionally accepts it; `MessageRepo` gets a `copyToSession` helper for efficient bulk copy
- **`apps/server`** — new fork routes, naming route, export route; no `index.ts` edits (route composition)
- **`packages/agent`** — no changes (forking is at the store level, not the loop level)

### Tests

- DB tests verify schema migration, fork operation, and `copyToSession` bulk copy
- Server tests verify fork route, naming route, export route, and error handling (404 on unknown session)
- Existing tests must remain green

### Risks

- **Fork copies messages** — for large sessions (thousands of messages), this could be slow. Mitigation: use a single `INSERT ... SELECT` SQL statement rather than loading into application memory and re-inserting.
- **Fork at messageIndex** — if the index points to a message that was later compacted, the fork is based on the compacted messages, not the original history. Accepted: compaction is lossy by nature.
