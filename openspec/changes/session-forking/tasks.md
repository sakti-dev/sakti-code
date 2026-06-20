## 1. DB schema: Add parentSessionId column

- [ ] 1.1 Add `parentSessionId` column to the `sessions` table in `packages/db/src/schema.ts` — nullable text, foreign key to `sessions.id`
- [ ] 1.2 Run DB tests: `cd packages/db && bun test` — verify existing tests pass (new column is nullable, no existing data affected)

## 2. DB: SessionRepo fork support

- [ ] 2.1 Add optional `parentSessionId?: string` parameter to `SessionRepo.create()`
- [ ] 2.2 Add `findByParent(parentId: string): Session[]` method to `SessionRepo` — queries sessions where `parentSessionId = parentId`
- [ ] 2.3 Write tests: create session with parent, find children, verify parentSessionId is stored
- [ ] 2.4 Run DB tests: `cd packages/db && bun test`

## 3. DB: SqliteSessionStore.fork

- [ ] 3.1 Add `fork(sourceSessionId: string, upToMessageIndex?: number): Promise<{ sessionId: string }>` to `SqliteSessionStore` in `packages/db/src/session-store.ts`
- [ ] 3.2 Implementation: load messages via `loadMessages`, slice at `upToMessageIndex`, create new session via `SessionRepo.create` with `parentSessionId`, copy messages via `MessageRepo.replaceForSession` in a transaction
- [ ] 3.3 Write tests: fork full session, fork at index, fork unknown session throws, fork preserves message order
- [ ] 3.4 Run DB tests: `cd packages/db && bun test`

## 4. DB: SessionRepo.findForkedChildren

- [ ] 4.1 Add `findForkedChildren(parentId: string)` method that returns all sessions with matching `parentSessionId`
- [ ] 4.2 Write tests: create session with 3 forked children, verify all returned

## 5. Server: Fork REST route

- [ ] 5.1 Write failing test `apps/server/src/__tests__/forking.test.ts`:
  - `POST /api/sessions/:id/fork` with no body → 200, new session with all messages copied, `parentSessionId` set
  - `POST /api/sessions/:id/fork` with `{ messageIndex: 3 }` → 200, new session with 4 messages
  - `POST /api/sessions/nope/fork` → 404
  - Run → RED.
- [ ] 5.2 Create `apps/server/src/routes/forking.ts` with fork route — resolve session, call `SqliteSessionStore.fork`, return new session
- [ ] 5.3 Register route via route composition (do NOT edit `apps/server/src/index.ts`)
- [ ] 5.4 Run → GREEN. Typecheck + lint.

## 6. Server: Fork-messages route

- [ ] 6.1 Write failing test `GET /api/sessions/:id/fork-messages`:
  - Returns user/assistant messages with `messageIndex`, `role`, `textPreview`
  - Tool results excluded
  - Empty session returns `[]`
  - Unknown session returns 404
  - Run → RED.
- [ ] 6.2 Add `GET /api/sessions/:id/fork-messages` route in `apps/server/src/routes/forking.ts` — load session messages via `MessageRepo.loadBySession`, filter user/assistant, map to simplified format
- [ ] 6.3 Run → GREEN. Typecheck + lint.

## 7. Server: Session naming route

- [ ] 7.1 Write failing test `PATCH /api/sessions/:id/name`:
  - Sets title and returns updated session
  - Empty title clears to null
  - Unknown session returns 404
  - Run → RED.
- [ ] 7.2 Create `apps/server/src/routes/naming.ts` (or add to `sessions.ts`): `PATCH /api/sessions/:id/name` with body `{ title: string }`
- [ ] 7.3 Register route via route composition
- [ ] 7.4 Run → GREEN. Typecheck + lint.

## 8. Server: HTML export route

- [ ] 8.1 Write failing test `GET /api/sessions/:id/export-html`:
  - Returns `text/html` with all messages rendered
  - Empty session returns HTML with title only
  - Unknown session returns 404
  - Run → RED.
- [ ] 8.2 Create `apps/server/src/routes/export.ts` with `GET /api/sessions/:id/export-html` — load messages, render into self-contained HTML template with inline CSS
- [ ] 8.3 Register route via route composition
- [ ] 8.4 Run → GREEN. Typecheck + lint.

## 9. Verification

- [ ] 9.1 Run full server suite: `bun vitest run apps/server/` — all tests pass
- [ ] 9.2 Run DB tests: `cd packages/db && bun test` — all pass
- [ ] 9.3 `bun typecheck` — 0 errors
- [ ] 9.4 `bun x ultracite fix` — 0 remaining diagnostics
