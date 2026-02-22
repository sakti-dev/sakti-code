# ADR-0001: Core-Server Boundary via Shared Bridge

## Status

Accepted (2026-02-22)

## Context

`@sakti-code/core` previously imported runtime DB/bus modules directly from `@sakti-code/server`:

- `@sakti-code/server/db`
- `@sakti-code/server/bus`

This created architecture and tooling problems:

1. Dependency direction violation: core depended on infrastructure.
2. Circular package pressure: server depends on core, while core reached into server.
3. TypeScript/project resolution instability across package builds.

## Decision

Introduce a shared boundary using `@sakti-code/shared/core-server-bridge`:

1. `shared` defines bridge contracts and registration functions.
2. `core` consumes only the bridge through `packages/core/src/server-bridge.ts`.
3. `server` registers concrete DB and bus bindings at startup:

- DB registration in `packages/server/db/index.ts`
- Bus registration in `packages/server/src/bus/index.ts`

## Consequences

### Positive

1. Clean dependency direction:

- `shared` -> no internal package dependency
- `core` -> `shared`
- `server` -> `core`, `shared`

2. Removes direct `core -> server` imports.
3. Improves package typecheck/build predictability.
4. Supports test-time binding with lightweight setup (`packages/core/tests/vitest.setup.ts`).

### Tradeoffs

1. Bridge contracts must remain aligned with server schema/runtime shape.
2. Registration order matters at runtime (bindings must be set before bridge use).

## Rules

1. `core` source must not import `@sakti-code/server/*`.
2. New cross-boundary runtime dependencies must go through the shared bridge.
3. Infrastructure implementations stay in `server`; bridge contracts stay in `shared`.
