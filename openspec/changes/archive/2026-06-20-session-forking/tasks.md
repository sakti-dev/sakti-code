## 1. DB schema: Add parentSessionId column

- [x] 1.1 Add `parentSessionId` column to the `sessions` table in `packages/db/src/schema.ts` — nullable text, foreign key to `sessions.id`
- [x] 1.2 Run DB tests: `cd packages/db && bun test` — verify existing tests pass (new column is nullable, no existing data affected)

## 2. DB: SessionRepo fork support

- [x] 2.1 Add optional `parentSessionId?: string` parameter to `SessionRepo.create()`
- [x] 2.2 Add `findForkedChildren(parentId: string): Session[]` method to `SessionRepo` — queries sessions where `parentSessionId = parentId`; removed redundant `findByParent`
- [x] 2.3 Write tests: create session with parent, find children, verify parentSessionId is stored
- [x] 2.4 Run DB tests: `cd packages/db && bun test`

## 3. DB: SqliteSessionStore.fork

- [x] 3.1 Add `fork(sourceSessionId: string, upToMessageIndex?: number): Promise<{ sessionId: string }>` to `SqliteSessionStore` in `packages/db/src/session-store.ts`
- [x] 3.2 Implementation: loads raw DB rows via `MessageRepo.loadBySession()`, slices at `upToMessageIndex`, creates new session via `SessionRepo.create` with `parentSessionId`, copies messages in a transaction (avoids AgentMessage round-trip content loss)
- [x] 3.3 Write tests: fork full session, fork at index, fork unknown session throws, fork preserves message order
- [x] 3.4 Run DB tests: `cd packages/db && bun test`

## 4. DB: SessionRepo.findForkedChildren

- [x] 4.1 Add `findForkedChildren(parentId: string)` method that returns all sessions with matching `parentSessionId`
- [x] 4.2 Write tests: create session with 3 forked children, verify all returned

## 5. Server: Fork REST route

- [x] 5.1 Write test `apps/server/src/__tests__/forking.test.ts`:
  - `POST /api/sessions/:id/fork` with no body → 200, new session with all messages copied, `parentSessionId` set
  - `POST /api/sessions/:id/fork` with `{ messageIndex: 3 }` → 200, new session with 4 messages
  - `POST /api/sessions/nope/fork` → 404
- [x] 5.2 Create `apps/server/src/routes/forking.ts` with fork route — resolve session, call `SqliteSessionStore.fork`, return new session
- [x] 5.3 Register route via route composition (no `apps/server/src/index.ts` edits)
- [x] 5.4 Run → GREEN. Typecheck + lint.

## 6. Server: Fork-messages route

- [x] 6.1 Write test `GET /api/sessions/:id/fork-messages`:
  - Returns user/assistant messages with `messageIndex`, `role`, `textPreview`
  - Tool results excluded
  - Empty session returns `[]`
  - Unknown session returns 404
- [x] 6.2 Add `GET /api/sessions/:id/fork-messages` route in `apps/server/src/routes/forking.ts` — load session messages via `MessageRepo.loadBySession`, filter user/assistant, map to simplified format
- [x] 6.3 Run → GREEN. Typecheck + lint.

## 7. Server: Session naming route

- [x] 7.1 Write test `PATCH /api/sessions/:id/name`:
  - Sets title and returns updated session
  - Empty title clears to null
  - Unknown session returns 404
- [x] 7.2 Create `apps/server/src/routes/naming.ts`: `PATCH /api/sessions/:id/name` with body `{ title: string }`
- [x] 7.3 Register route via route composition
- [x] 7.4 Run → GREEN. Typecheck + lint.

## 8. Server: HTML export route

- [x] 8.1 Write test `GET /api/sessions/:id/export-html`:
  - Returns `text/html` with all messages rendered
  - Empty session returns HTML with title only
  - Unknown session returns 404
- [x] 8.2 Create `apps/server/src/routes/export.ts` with `GET /api/sessions/:id/export-html` — load messages, render into self-contained HTML template with inline CSS
- [x] 8.3 Register route via route composition
- [x] 8.4 Run → GREEN. Typecheck + lint.

## 9. Verification

- [x] 9.1 Run full server suite: `bun test --path-ignore-patterns '**/agent/**'` — 69/69 tests pass
- [x] 9.2 Run DB tests: `cd packages/db && bun test` — 16/16 pass
- [x] 9.3 `bun typecheck` — 0 errors
- [x] 9.4 `bun x ultracite fix` — 0 remaining diagnostics (1 acceptable: self-referencing FK `any` cast removed)
