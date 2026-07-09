# Prompt History (ArrowUp/Down Recall) — Design

Date: 2026-07-09

## Goal

Let the user cycle through previously-sent prompts with ArrowUp/ArrowDown
inside the chat input, just like coding-agent CLIs. Scope: **per-project,
persisted across sessions**.

## Data source (no new schema)

User prompts already live in `session_entries` as `kind = 'message'` rows whose
parsed `content.message.role === "user"`. The history is derived by querying
those rows, scoped to a project via the `sessions.projectId` foreign key:

```sql
SELECT se.content, se.created_at
FROM session_entries se
JOIN sessions s ON s.id = se.session_id
WHERE s.project_id = :projectId AND se.kind = 'message'
ORDER BY se.created_at DESC
LIMIT :limit
```

Then in JS: parse `content` JSON, keep `message.role === "user"`, extract text
(string or content parts — reuse the `extractText` logic), drop empty /
whitespace-only, **dedup exact (case-sensitive)**, newest-first.

## Endpoint

`GET /api/projects/:id/prompt-history?limit=50` → `{ prompts: string[] }`
(newest-first). New route module
`apps/server/src/routes/projects/prompt-history.ts`, composed in `buildApp`
alongside `search-files.ts` / `context.ts`. Uses `ctx.repos.projects.findById`
for the 404 guard, raw Drizzle against `sessionEntries` + `sessions` for the
query.

## Cursor state machine (pure, unit-tested)

Module: `apps/desktop/src/components/chat-input/prompt-history.ts`.

- `history`: `string[]`, newest → oldest.
- `index`: `number | null`. `null` = not navigating (live draft).
- `draft`: the in-progress text saved when navigation begins.

Transitions:

- `up(draft)`:
  - `index === null` → save `draft`, set `index = 0`.
  - else → `index = min(index + 1, history.length - 1)`.
- `down()`:
  - `index === null` → no-op.
  - else → `index - 1`; if `< 0` → `index = null`, return saved `draft`.

`current()` returns `history[index]` when navigating, else `null`.

## Key handling in `ChipInput`

`ChipInput` owns the contenteditable + caret, so it decides when an arrow key is
a "history" event vs. normal cursor movement:

- ArrowUp, **no token-menu active**, caret at editor **start**
  (`isAtEditorStart`) → preventDefault + `props.onHistoryNavigate?.("up")`.
- ArrowDown, no menu, caret at editor **end** (new `isAtEditorEnd` helper) →
  `props.onHistoryNavigate?.("down")`.
- Otherwise default behavior (multi-line cursor movement).

## Editor injection

Add `setText(text: string)` to `ChipInputApi`: replaces editor content, moves
caret to end, emits `onChange`. `ChatInput` calls it on each navigate.

`ChatInput` owns: the `createResource` (keyed on `projectId`), the cursor
state + draft, and the `onHistoryNavigate(dir)` handler. On navigate it resolves
the next text (cursor move or draft restore) and calls `chipApi.setText(...)`.

## Freshness

- `createResource` keyed on `projectId()`; refetch after each successful send so
  the just-sent prompt is immediately recallable.
- Reset cursor (`index = null`, clear draft) on send and on project change.

## Edge cases

- Empty / whitespace-only prompts skipped.
- Image-only user messages → empty text → skipped.
- Dedup is exact, case-sensitive, newest occurrence wins.
- `limit` clamped to [1, 100], default 50.

## Tests

- **Server** (`prompt-history.route.test.ts`): fixtures spanning two projects
  with user + assistant entries; asserts only the target project's user prompts
  are returned, deduped, newest-first, limit respected.
- **Desktop — cursor module** (`prompt-history.test.ts`): the up/down/null/draft
  state machine in isolation.
- **Desktop — ChipInput wiring** (`chip-input.test.tsx`): ArrowUp at editor
  start fires `onHistoryNavigate("up")` (and not when a token menu is active or
  caret is mid-text); ArrowDown at end fires `onHistoryNavigate("down")`.

## Non-goals

- No fuzzy search / filtering of history by typed text (v1).
- No persistence of a separate MRU list — history is derived from messages.
- No cross-project history.
