# Monorepo Architecture

## Overview

ekacode uses a monorepo structure managed by Turborepo. This document explains why we chose this approach and how the workspace is organized.

## Why Monorepo?

### Benefits

1. **Atomic Commits**: Changes across packages can be committed together
2. **Code Sharing**: Easy to import code between packages without npm publishing
3. **Unified Dependencies**: Single `package.json` at root manages all dependencies
4. **Type Safety**: TypeScript works across package boundaries seamlessly
5. **Faster Development**: No need to publish/unpublish packages during development

### Alternatives Considered

| Approach              | Pros                                | Cons                            | Decision    |
| --------------------- | ----------------------------------- | ------------------------------- | ----------- |
| **Monorepo** (chosen) | Atomic commits, type safety, simple | Can be slower builds            | ✅ Chosen   |
| Multi-repo            | Clear boundaries, independent       | Complex syncing, no type safety | ❌ Rejected |
| Single package        | Simplest                            | No separation of concerns       | ❌ Rejected |

## Package Structure

```
ekacode/
├── packages/
│   ├── desktop/          # Electron main + renderer
│   ├── server/           # Hono HTTP server
│   ├── ekacode/          # Mastra agents + tools
│   └── shared/           # Shared types + utilities
├── docs/                 # Documentation
├── package.json          # Root package.json
├── turbo.json            # Turborepo configuration
└── pnpm-workspace.yaml   # pnpm workspace definition
```

## Package Dependencies

```
┌─────────────┐
│   desktop   │
│  (Electron) │
└──────┬──────┘
       │ uses
       ├─────────────┐
       ▼             ▼
┌───────────┐  ┌──────────┐
│  server   │  │ ekacode  │
│  (Hono)   │  │ (Mastra) │
└─────┬─────┘  └─────┬────┘
      │              │
      └──────┬───────┘
             ▼
      ┌──────────┐
      │  shared  │
      │  (types) │
      └──────────┘
```

### Dependency Rules

- **desktop** → **server** (IPC integration, server startup)
- **desktop** → **ekacode** (PermissionManager access)
- **server** → **ekacode** (Tool registry, agents)
- **ekacode** → **shared** (Type definitions)
- **server** → **shared** (Type definitions)

### No Circular Dependencies

The graph is acyclic by design:

- `shared` has NO dependencies (base layer)
- `ekacode` only depends on `shared`
- `server` depends on `ekacode` and `shared`
- `desktop` depends on everything else

## Workspace Configuration

### pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
```

This simple configuration tells pnpm to treat all subdirectories under `packages/` as workspace packages.

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

**Key Points**:

- `^build` means "depend on builds in packages this package depends on"
- Outputs are cached for faster rebuilds
- `dev` task is not cached and runs persistently

## Package Exports

Each package uses TypeScript's `exports` field for clean imports:

### packages/desktop/package.json

```json
{
  "name": "@ekacode/desktop",
  "exports": {
    "./main": "./src/main/index.ts",
    "./preload": "./src/preload/index.ts"
  }
}
```

### packages/server/package.json

```json
{
  "name": "@ekacode/server",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

### packages/ekacode/package.json

```json
{
  "name": "@ekacode/ekacode",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

### packages/shared/package.json

```json
{
  "name": "@ekacode/shared",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

## Import Patterns

### Within the Monorepo

Use workspace protocol for dependencies:

```json
{
  "dependencies": {
    "@ekacode/shared": "workspace:*",
    "@ekacode/server": "workspace:*"
  }
}
```

### In TypeScript Code

```typescript
// packages/desktop/src/main/index.ts
import { startServer } from "@ekacode/server";
import { PermissionManager } from "@ekacode/ekacode";

// packages/ekacode/src/tools/filesystem/read.ts
import type { SessionContext } from "@ekacode/shared";
```

## Build Order

Turborepo automatically determines build order based on dependencies:

```
1. shared (no deps)
2. ekacode (depends on: shared)
3. server (depends on: ekacode, shared)
4. desktop (depends on: server, ekacode, shared)
```

Run all builds in correct order:

```bash
pnpm build      # Turborepo handles ordering
```

Build specific package with dependencies:

```bash
pnpm --filter @ekacode/ekacode build
```

## Development Workflow

### Adding a New Package

1. Create directory: `packages/new-package/`
2. Initialize: `pnpm init`
3. Add to workspace: Automatically recognized by `pnpm-workspace.yaml`
4. Add dependencies: Use `workspace:*` protocol
5. Import: Use `@ekacode/new-package` in other packages

### Adding Dependencies

To add a dependency to a specific package:

```bash
pnpm add --filter @ekacode/ekacode zod
```

To add to all packages:

```bash
pnpm add -D typescript
```

## Troubleshooting

### "Cannot find module" errors

**Cause**: TypeScript doesn't know about workspace packages

**Fix**: Ensure each package has `package.json` with `exports` field

### "Cannot resolve workspace" errors

**Cause**: pnpm workspace not linked

**Fix**: Run `pnpm install` from root

### Build cache issues

**Cause**: Turborepo cached stale build

**Fix**: Run `pnpm build --force`

## Future Considerations

### Potential Changes

1. **Add more packages**: As the project grows (e.g., separate renderer package)
2. **Version policy**: Currently all `0.0.1`, may need semantic versioning
3. **Publishing**: If we want to publish packages to npm (not needed for desktop app)

### Monitoring

- Watch for circular dependencies (pnpm will warn)
- Monitor build times (Turborepo cache effectiveness)
- Check bundle sizes (Electron app size matters)

---

_Updated: 2025-01-25_
