## 1. WS welcome push

- [ ] 1.1 Update `apps/server/src/agent/ws.ts`: in the `open(ws)` handler, add `ws.send(JSON.stringify({ type: "welcome", version, cwd: process.cwd() }))`
- [ ] 1.2 Read `version` from `apps/server/package.json` (import or `Bun.file`)
- [ ] 1.3 Write test: connect to WS, expect welcome frame with version and cwd fields
- [ ] 1.4 Run → GREEN. Typecheck + lint.

## 2. Turn diff route

- [ ] 2.1 Write failing test `apps/server/src/__tests__/diff.test.ts`:
  - `GET /api/sessions/:id/turn-diff` for a session in a git repo → 200 with `files` array and `diff`
  - `GET /api/sessions/nope/turn-diff` → 404
  - `GET /api/sessions/:id/turn-diff?files[]=src/index.ts` → 200, only that file in results
  - Run → RED.
- [ ] 2.2 Create `apps/server/src/routes/turn-diff.ts`: resolve session → project cwd → run `git diff HEAD` and `git diff HEAD --numstat` → parse numstat output into per-file summaries → return structured result
- [ ] 2.3 Handle empty repo (no HEAD): catch `git rev-parse HEAD` failure → return empty diff
- [ ] 2.4 Register route via route composition
- [ ] 2.5 Run → GREEN. Typecheck + lint.

## 3. Last assistant text route

- [ ] 3.1 Write failing test `GET /api/sessions/:id/last-assistant-text`:
  - Returns `{ text: "..." }` for session with assistant messages
  - Returns `{ text: null }` for session with no assistant messages
  - Unknown session returns 404
  - Run → RED.
- [ ] 3.2 Create `apps/server/src/routes/last-assistant-text.ts`: query messages where `role = "assistant"`, order by `createdAt DESC`, return text of first or null
- [ ] 3.3 Register route via route composition
- [ ] 3.4 Run → GREEN. Typecheck + lint.

## 4. File search route

- [ ] 4.1 Write failing test `GET /api/projects/:id/search-files?query=&limit=`:
  - Returns matching files in the project directory
  - Unknown project returns 404
  - Respects limit parameter
  - Run → RED.
- [ ] 4.2 Create `apps/server/src/routes/search-files.ts`: shell to `fd` (args: `--type f --type d --max-results <limit> --color never <query>`), fallback to `find` with ignore patterns
- [ ] 4.3 Register route via route composition
- [ ] 4.4 Run → GREEN. Typecheck + lint.

## 5. Workspace persistence routes

- [ ] 5.1 Write failing test `GET /api/workspace/sessions`:
  - Returns empty array initially
  - `POST /api/workspace/sessions` with `{ sessionPath }` adds and returns updated array
  - Duplicate POST is idempotent
  - `DELETE /api/workspace/sessions/:path` removes path
  - Deleting non-existent path is idempotent
  - Run → RED.
- [ ] 5.2 Create `apps/server/src/routes/workspace.ts`: uses `settings` table with key `workspace:sessions`, value is JSON array of paths
- [ ] 5.3 The DELETE route needs URL-decoding for the path parameter (encodeURIComponent on client side, decodeURIComponent on server)
- [ ] 5.4 Register route via route composition
- [ ] 5.5 Run → GREEN. Typecheck + lint.

## 6. Session commands route

- [ ] 6.1 Write failing test `GET /api/sessions/:id/commands`:
  - Returns commands array with name and description
  - Includes search, clear, compact, help
  - Unknown session returns 404
  - Run → RED.
- [ ] 6.2 Create `apps/server/src/routes/commands.ts`: return hardcoded commands list, function-returned for future extensibility
- [ ] 6.3 Register route via route composition
- [ ] 6.4 Run → GREEN. Typecheck + lint.

## 7. Verification

- [ ] 7.1 Run full server suite: `bun vitest run apps/server/` — all tests pass
- [ ] 7.2 `bun typecheck` — 0 errors
- [ ] 7.3 `bun x ultracite fix` — 0 remaining diagnostics
