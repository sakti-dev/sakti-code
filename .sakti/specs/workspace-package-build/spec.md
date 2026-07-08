# workspace-package-build Specification

## Purpose

Defines how `@sakti-code/*` workspace packages are compiled to distributable JavaScript and consumed. Workspace packages ship raw TypeScript source for dev tooling (tsx, Vite, Vitest) but MUST compile to ESM under `dist/` for runtime consumption (notably the packaged Electron app), so they are never loaded as `.ts` from `node_modules`.

## Requirements

### Requirement: Workspace packages compile to distributable ESM

Every workspace package under `packages/*` (and any workspace dependency of the desktop app) SHALL provide a `build` script that compiles its TypeScript source to distributable ESM JavaScript plus declaration files (`.d.ts`) under a `dist/` directory. Source under `src/` SHALL remain the edit-time source of truth; `dist/` SHALL be a build artifact (gitignored). The package SHALL NOT be consumed at runtime as raw `.ts` from `node_modules`.

#### Scenario: build emits ESM and declarations

- **WHEN** a package's `build` script runs
- **THEN** `dist/` contains an ESM `.js` entry corresponding to each `src/` entry
- **AND** each emitted `.js` has a sibling `.d.ts`
- **AND** no `.ts` file is referenced by the package's runtime `exports`

#### Scenario: source remains the source of truth

- **WHEN** `dist/` is deleted
- **THEN** `src/` is unchanged and the next `build` regenerates `dist/`

### Requirement: Conditional package exports resolve dev source vs runtime dist

Each workspace package's `package.json` `exports` map SHALL be conditional. The `"development"` condition SHALL resolve to source `.ts` (so tsx, Vite dev, and Vitest continue to transpile source directly with no prior build). The `"default"` condition SHALL resolve to compiled `dist/*.js`, and the `"types"` condition SHALL resolve to `dist/*.d.ts`. Subpath exports SHALL each follow the same condition shape.

#### Scenario: dev tooling resolves source TypeScript

- **WHEN** a dev-time tool (tsx, Vite dev server, Vitest) imports a workspace package using the `"development"` condition
- **THEN** it resolves to the package's `src/*.ts`
- **AND** no `dist/` build is required for the import to succeed

#### Scenario: runtime resolves compiled JavaScript

- **WHEN** Node (Electron main, or a packaged artifact) imports a workspace package without the `"development"` condition
- **THEN** it resolves to the compiled `dist/*.js`
- **AND** no TypeScript stripping is attempted under `node_modules`

#### Scenario: type resolution points at declarations

- **WHEN** a TypeScript consumer resolves a workspace package's types
- **THEN** the `"types"` condition resolves to `dist/*.d.ts`

### Requirement: Turbo orchestrates a topological package build

The repo SHALL expose a root `pnpm run build` script that runs `turbo run build`. The turbo `build` task SHALL depend on `^build` (upstream packages build first) and declare `dist/**` as its output. Workspace packages consumed by the desktop app SHALL be built before the desktop `package` script runs.

#### Scenario: dependency order is respected

- **WHEN** `turbo run build` runs and `@sakti-code/server` depends on `@sakti-code/agent`
- **THEN** `@sakti-code/agent` is built before `@sakti-code/server`

#### Scenario: packaging builds dependencies first

- **WHEN** `apps/desktop` `package` script runs
- **THEN** `turbo run build` completes for all consumed workspace packages before `electron-vite build`
- **AND** the packaged app's `node_modules/@sakti-code/*` resolve to compiled `dist/`
