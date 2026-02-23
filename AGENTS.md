# Repository Guidelines

## Project Structure & Module Organization

This repository is a `pnpm` monorepo managed with Turbo.

- `apps/desktop`: Electron/SolidJS desktop UI (main markdown migration surface).
- `apps/electron`, `apps/preload`: Electron process and preload layers.
- `packages/core`: shared domain logic and chat/server contracts.
- `packages/server`: backend/runtime services, DB schema, and model snapshot tooling.
- `packages/shared`, `packages/zai`, `packages/memorable-name`: shared utilities and supporting libs.
- `docs/`: architecture notes and implementation plans.
- `scripts/`: repo-level automation (fixtures, migration checks, model snapshot updates).

## Build, Test, and Development Commands

Run from repository root unless noted.

- `pnpm dev`: starts local development orchestration.
- `pnpm dev:p`: runs package `dev` tasks in parallel via Turbo.
- `pnpm build`: builds all packages/apps.
- `pnpm test`: runs tests across workspaces where present.
- `pnpm lint`: runs ESLint across workspaces.
- `pnpm typecheck`: runs TypeScript checks across workspaces.

Desktop-focused examples:

- `pnpm --filter @sakti-code/desktop test:ui`
- `pnpm --filter @sakti-code/desktop markdown:migration:health`

## Coding Style & Naming Conventions

- Language: TypeScript (`.ts`/`.tsx`), ESM modules.
- Formatting: Prettier (`pnpm format` / `pnpm format:check`).
- Linting: ESLint (`eslint.config.js`) with `@typescript-eslint`.
- Unused variables: prefix intentionally unused names with `_`.
- Use path aliases where configured (for example `@/` in desktop tests); avoid deep relative imports blocked by lint rules.
- Follow existing naming patterns: `kebab-case` files, `PascalCase` components, `camelCase` functions.

## Testing Guidelines

- Framework: Vitest (workspace-specific configs like `apps/desktop/vitest.config.ts`).
- Keep tests near source in `__tests__` and integration tests under `tests/integration`.
- Naming: `*.test.ts` / `*.test.tsx`.
- Prefer behavior-driven assertions over implementation coupling.
- For desktop, validate all three projects when relevant: `test:unit`, `test:ui`, `test:integration`.

## Commit & Pull Request Guidelines

- Use Conventional Commit style seen in history: `feat(desktop): ...`, `test(desktop): ...`, `chore(desktop): ...`.
- Keep commits scoped to one logical change.
- PRs should include:
- what changed and why
- affected packages/apps
- verification commands run (for example `pnpm lint`, `pnpm typecheck`, targeted Vitest commands)
- screenshots/GIFs for UI changes in `apps/desktop`
