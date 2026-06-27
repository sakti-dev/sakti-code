# Wire agent-effect to Server

## Goal

Replace `@sakti-code/agent` with `@sakti-code/agent-effect` in `apps/server/` and `apps/desktop/`. Server stays plain async/Promise — the swap is a drop-in replacement. All perf fixes, bug fixes, and Effect-native internals in `agent-effect` land in production without changing server code.

## Approach

Mechanical package swap. No server code logic changes.

## What changes

- `apps/server/package.json`: dependency `@sakti-code/agent` → `@sakti-code/agent-effect`
- `apps/server/tsconfig.json`: path mapping update
- `apps/desktop/package.json`: dependency swap (types-only imports)
- `apps/desktop/tsconfig.json`: path mapping update
- 23 server source files: `from "@sakti-code/agent"` → `from "@sakti-code/agent-effect"`
- 19 desktop source files: same rename (all type-only)

## What stays the same

- All server code logic (runner.ts, ws-handler.ts, tools-builder.ts, route modules)
- `SqliteSessionStorage` — implements Promise-based `SessionStorage` interface, still exported by `agent-effect`
- 5 `@migration` wrappers — stay as the Promise boundary
- `packages/agent/` — kept, tests still run

## Verification

- `pnpm run typecheck`
- `cd apps/server && pnpm run test`
- `cd apps/desktop && pnpm run test`
- `pnpm run dev:server` starts successfully
