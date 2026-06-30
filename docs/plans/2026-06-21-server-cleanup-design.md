# Server Cleanup Design: Remove Leaking Agent Abstractions

**Date:** 2026-06-21
**Status:** Approved
**Follows:** `2026-06-21-unify-persistence.md`

## Goal

Remove five places where agent-layer concerns leak into the Elysia REST server, so the server returns to its documented "REST-for-state, WS-for-streaming" split.

## Background

After the unify-persistence work, an audit of `apps/server/src/routes/` surfaced six places where the server was doing work that belongs elsewhere (agent loop, WS protocol, or client). One (search-files) was deemed acceptable duplication; the other five are in scope for this cleanup.

The client (`apps/app/`) currently consumes **none** of the affected routes (grep confirmed empty), so the API can change freely without migration shims.

## Scope

Five cleanups, executed as independent tasks in risk order:

### Task 1 — Delete `naming.ts`

`PATCH /api/sessions/:id/name` is a subset of `PATCH /api/sessions/:id` in `sessions.ts:53-67`, which already accepts `{ title }` through `t.Partial(...)`. Pure deletion; no spec mention.

### Task 2 — Delete `commands.ts`

`GET /api/commands` returns a hardcoded list of slash commands (`/search`, `/clear`, `/compact`, `/help`). Slash commands are a client/agent concern, not a server-curated catalog. Delete the route and `openspec/specs/session-commands/` folder. No server replacement.

### Task 3 — Drop `injectToContext` from `bash.ts`

`POST /api/sessions/:id/bash` with `{ injectToContext: true }` writes a `toolResult` entry with `toolName: "user_bash"` via `Session.appendMessage()` (`bash.ts:139-158`). This reinvents agent tool calls alongside the real `BashTool`. Drop the `injectToContext` body field and the entry-tree write block. `bash.ts` becomes purely a host-execution endpoint (consistent with `terminals.ts`). Users who want the agent to see command output paste it as a user message.

Spec impact: remove the "Bash result injection" requirement from `openspec/specs/user-bash/spec.md`.

### Task 4 — Merge `turn-diff.ts` into `git.ts`

`GET /api/sessions/:id/turn-diff` overlaps with `GET /api/git/diff`. Move `parseNumstat` + the handler into `git.ts` as `GET /api/git/turn-diff?projectId=...&files[]=...` (project-scoped, consistent with the other `/api/git/*` routes). Delete `turn-diff.ts` and `openspec/specs/turn-diff/`. Update tests to use `projectId`.

### Task 5 — Move `session-controls.ts` to WS

`POST /api/sessions/:id/steer` and `POST /api/sessions/:id/follow-up` reach into `getActiveHarness(sessionId)` from `runner.ts:69` and call harness methods. The run loop itself is already WS-based via `ws-handler.ts`. This creates two control planes for the same harness.

Add two inbound WS frame types to `ws-handler.ts`:

```ts
{ type: "steer", message: string }
{ type: "followUp", message: string }
```

The handler looks up the active run via `getActiveHarness(sessionId)` and calls the matching method. If no active run exists, push an error frame `{ type: "error", message: "..." }`. Delete `session-controls.ts`, drop from `index.ts`, delete its tests. Rewrite `openspec/specs/session-controls/spec.md` to specify WS frames instead of REST endpoints. Keep `getActiveHarness` in `runner.ts` (now consumed by the WS handler instead of the REST route).

## Spec Impact Summary

| Spec                                      | Action                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `openspec/specs/session-commands/`        | Delete folder                                                                                                       |
| `openspec/specs/turn-diff/`               | Delete folder                                                                                                       |
| `openspec/specs/user-bash/spec.md`        | Remove "Bash result injection" requirement + scenario                                                               |
| `openspec/specs/session-controls/spec.md` | Rewrite: REST endpoints → WS frame types                                                                            |
| `AGENTS.md` route table                   | Drop `commandsRoutes`, `sessionControlRoutes`; merge turn-diff row into `gitRoutes`; drop `injectToContext` mention |

## Out of Scope

- **`search-files.ts`** — leaving as-is. Different consumer (UI file picker vs agent tool calls) justifies the duplicated fd/find wrapping.
- **Client migration** — client doesn't currently use any affected routes.
- **`runner.ts` deeper refactor** — `getActiveHarness` stays; only its consumer changes.

## Approach

Five independent tasks, each following TDD (RED → GREEN → commit). Ordered by risk: trivial deletions first, modifications next, WS migration last. Each task is self-contained and can be reviewed or reverted independently.

After all five: full verification (typecheck, lint, all three test suites), update `AGENTS.md` route table.
