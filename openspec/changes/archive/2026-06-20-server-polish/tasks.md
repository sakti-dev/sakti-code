## 1. WS welcome push

- [x] 1.1 Update `apps/server/src/agent/ws.ts`: in the `open(ws)` handler, add `ws.send(createWelcomeFrame())`
- [x] 1.2 Read `version` from `apps/server/package.json` — exported as `SERVER_VERSION` + `createWelcomeFrame()`
- [x] 1.3 Write test: `createWelcomeFrame()` returns valid welcome frame with version and cwd fields
- [x] 1.4 Run → GREEN. Typecheck + lint.

## 2. Turn diff route

- [x] 2.1 Write test `apps/server/src/__tests__/diff.test.ts`: session in git repo returns 200, unknown session returns 404, file filter returns only that file
- [x] 2.2 Create `apps/server/src/routes/turn-diff.ts`: resolve session → project cwd → run `git diff HEAD` + `--numstat` → parse structured result
- [x] 2.3 Handle empty repo (no HEAD): catch gracefully → return empty diff
- [x] 2.4 Register route via route composition (tests use `makeApp([turnDiffRoutes])`)
- [x] 2.5 Run → GREEN. Typecheck + lint.

## 3. Last assistant text route

- [x] 3.1 Write test: returns `{ text }` for session with assistant messages, `{ text: null }` for no assistant, 404 for unknown
- [x] 3.2 Create `apps/server/src/routes/last-assistant-text.ts`: use MessageRepo to find last assistant message
- [x] 3.3 Register route via route composition
- [x] 3.4 Run → GREEN. Typecheck + lint.

## 4. File search route

- [x] 4.1 Write test: returns matching files, unknown project 404, empty query returns empty, respects limit
- [x] 4.2 Create `apps/server/src/routes/search-files.ts`: `fd` with fallback to `find` (safe args array, no shell injection)
- [x] 4.3 Register route via route composition
- [x] 4.4 Run → GREEN. Typecheck + lint.

## 5. Workspace persistence routes

- [x] 5.1 Write test: empty initially, POST adds path, duplicate POST idempotent, DELETE removes, non-existent DELETE idempotent
- [x] 5.2 Create `apps/server/src/routes/workspace.ts`: uses `settings` table with key `workspace:sessions`, JSON array of paths
- [x] 5.3 DELETE route URL-decodes the path parameter
- [x] 5.4 Register route via route composition
- [x] 5.5 Run → GREEN. Typecheck + lint.

## 6. Session commands route

- [x] 6.1 Write test: returns commands array with search/clear/compact/help, each has name+description, unknown session 404
- [x] 6.2 Create `apps/server/src/routes/commands.ts`: hardcoded commands via function-returned for extensibility
- [x] 6.3 Register route via route composition
- [x] 6.4 Run → GREEN. Typecheck + lint.

## 7. Verification

- [x] 7.1 Run full server suite: `bun test --path-ignore-patterns '**/agent/**'` — 54/54 tests pass
- [x] 7.2 `bun typecheck` — 0 errors
- [x] 7.3 `bun x ultracite fix` — 0 remaining diagnostics
