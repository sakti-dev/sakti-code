# OpenCode Multi-Provider Parity (All Providers) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reach practical OpenCode provider parity across server/core/desktop while keeping `zai` and `zai-coding-plan` on our own SDK in `packages/zai`.

**Architecture:** Mirror OpenCode’s provider pipeline in three layers: models metadata ingestion, provider/auth/runtime resolution, and UI connection/model selection. Replace request-time global env mutation with scoped runtime context to prevent credential leakage across concurrent chats.

**Tech Stack:** TypeScript, Hono, AI SDK providers, MiniSearch, unstorage (`fs-lite`), Vitest, SolidJS, pnpm.

---

## Summary

- Skills applied for this plan: `brainstorming`, `writing-plans`, and `test-driven-development`.
- This plan covers remaining parity notes: provider-specific loader parity, provider option merging parity, plugin hook compatibility groundwork, API contract parity, and security/concurrency hardening.
- Every phase includes an OpenCode alignment checkpoint against source files under `opencode/packages`.
- Execution is strict TDD: failing test first, verify fail, minimal implementation, verify pass, then refactor.

## Important Public API / Interface Changes

1. Extend provider APIs for parity-compatible metadata in `packages/server/src/routes/provider.ts` and `packages/server/src/routes/provider.openapi.ts`.
2. Extend model descriptor shape in `packages/server/src/provider/schema.ts` and `packages/server/src/provider/types.ts` to carry runtime provider metadata used by core.
3. Introduce scoped provider runtime context type for chat execution (new context object passed from server to core, replacing global process env mutation path).
4. Add plugin-compatible hook interfaces (no external loading yet) in a new `packages/core/src/plugin/` module.
5. Keep existing desktop API client contract backward compatible in `apps/desktop/src/core/services/api/provider-client.ts`.

## Phases

1. Provider catalog and endpoint parity.
2. Models.dev + snapshot pipeline parity.
3. Auth/OAuth method parity surface.
4. Core runtime loader parity (preserve `packages/zai`).
5. Remove global env mutation and introduce scoped runtime context.
6. Provider transform and variant parity.
7. Plugin compatibility groundwork (no external plugin loading yet).
8. Desktop provider UX parity completion.
9. Model search/ranking hardening (MiniSearch).
10. Credential storage security hardening.

## Mandatory Verification Gate

1. `pnpm --filter @sakti-code/server test`
2. `pnpm --filter @sakti-code/core test`
3. `pnpm --filter @sakti-code/desktop test:run`
4. `pnpm typecheck`
5. `pnpm lint`
