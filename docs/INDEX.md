# ekacode Documentation

This directory contains comprehensive documentation for the ekacode project, covering architectural decisions, implementation details, and design rationale for each development phase.

## Document Structure

```
docs/
├── INDEX.md                           # This file - documentation index
├── architecture/                      # Core architecture documentation
│   ├── monorepo.md                    # Monorepo structure and workspace setup
│   ├── typesystem.md                  # Shared type system design
│   ├── security.md                    # Security model and permissions
│   └── logging.md                     # Centralized logging with Pino
├── phase-0-foundation/                # Phase 0: Foundation
│   └── project-setup.md               # Monorepo initialization
├── phase-1-server-agent/              # Phase 1: Server & Agent Core
│   ├── hono-server.md                 # Hono server implementation
│   ├── mastra-integration.md          # Mastra framework integration
│   └── permission-system.md           # Event-based permission system
├── phase-2-tools/                     # Phase 2: Core Tools
│   ├── tool-infrastructure.md         # Tool base utilities and registry
│   └── filesystem-tools.md            # All 7 filesystem tools
└── phase-5-desktop/                   # Phase 5: Desktop Integration
    ├── ipc-bridge.md                  # IPC communication layer
    └── server-management.md           # Server lifecycle management
```

## Phase Completion Status

| Phase                          | Status      | Documentation |
| ------------------------------ | ----------- | ------------- |
| Phase 0: Foundation            | ✅ Complete | ✅ Full       |
| Phase 1: Server & Agent Core   | ✅ Complete | ✅ Full       |
| Phase 2.1: Tool Infrastructure | ✅ Complete | ✅ Full       |
| Phase 2.2: Filesystem Tools    | ✅ Complete | ✅ Full       |
| Phase 5.1: IPC Bridge          | ✅ Complete | ✅ Full       |
| Phase 5.4: Server Management   | ✅ Complete | ✅ Full       |

## Reading Order

For new developers joining the project, recommended reading order:

**Start Here** (Architecture Fundamentals)

1. `architecture/monorepo.md` - Understand the workspace structure
2. `architecture/typesystem.md` - Learn about shared types
3. `architecture/security.md` - Understand security model
4. `architecture/logging.md` - Learn about logging and searching logs

**Foundation** (Project Setup)

4. `phase-0-foundation/project-setup.md` - How the project was initialized

**Core Systems** (Server & Agent)

5. `phase-1-server-agent/hono-server.md` - HTTP server implementation
6. `phase-1-server-agent/mastra-integration.md` - Agent framework setup
7. `phase-1-server-agent/permission-system.md` - Permission flow

**Tools** (Filesystem Operations)

8. `phase-2-tools/tool-infrastructure.md` - Tool base utilities
9. `phase-2-tools/filesystem-tools.md` - All 7 filesystem tools

**Desktop** (Electron Integration)

10. `phase-5-desktop/ipc-bridge.md` - Main/renderer communication
11. `phase-5-desktop/server-management.md` - Server lifecycle

## Quick Reference

### Key Design Decisions

#### Monorepo with pnpm + Turborepo

**Why**: Atomic commits, type safety, efficient builds
**Trade-off**: More complex setup than single package

#### Hono in Electron Main Process

**Why**: Single binary, offline-first, secure IPC
**Trade-off**: Server restarts require app restart

#### Mastra Framework

**Why**: Modern, TypeScript-first, streaming native
**Trade-off**: Newer framework, smaller community

#### Event-Based Permission System

**Why**: Non-blocking, decoupled, extensible
**Trade-off**: More complex than direct function calls

### Important Files

| File                                   | Purpose                      |
| -------------------------------------- | ---------------------------- |
| `pnpm-workspace.yaml`                  | pnpm workspace definition    |
| `turbo.json`                           | Build pipeline configuration |
| `packages/shared/src/types.ts`         | Shared TypeScript types      |
| `packages/ekacode/src/mastra.ts`       | Mastra instance              |
| `packages/ekacode/src/agents/coder.ts` | Coder agent definition       |
| `packages/server/src/index.ts`         | Hono server                  |
| `packages/desktop/src/main/index.ts`   | Electron main process        |

### Common Patterns

#### Adding a New Tool

1. Create file in `packages/ekacode/src/tools/filesystem/`
2. Use `createTool` from Mastra
3. Define Zod schemas for input/output
4. Implement `execute` method
5. Register in `packages/ekacode/src/tools/registry.ts`
6. Export from `packages/ekacode/src/tools/index.ts`

#### Adding a New Permission Type

1. Update `PermissionType` union in `packages/shared/src/types.ts`
2. Add permission handling in tools
3. Update `PermissionManager` if needed
4. Document in `architecture/security.md`

#### Adding IPC Channel

1. Add handler in `packages/desktop/src/main/index.ts`
2. Expose via `contextBridge` in preload
3. Add TypeScript definition in preload types
4. Document in `phase-5-desktop/ipc-bridge.md`

## Contributing

When adding new features or phases:

1. Update this index with new documentation
2. Follow the existing documentation structure
3. Include design rationale (why, not just what)
4. Document trade-offs and alternatives considered
5. Keep code examples synchronized with actual implementation

### Documentation Template

```markdown
# [Feature Name]

## Overview

[Brief description of the feature]

## Design Decisions

### Why This Approach?

[Alternatives considered and trade-offs]

## Implementation Details

[How it works, with code examples]

## Usage

[How to use the feature]

## Future Enhancements

[Planned improvements]
```

## Resources

### External Documentation

- [Mastra Documentation](https://mastra.ai/)
- [Hono Documentation](https://hono.dev/)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Turborepo Documentation](https://turbo.build/repo/docs)

### Internal References

- [ROADMAP.md](../ROADMAP.md) - Development roadmap
- [PRD](../PRD.md) - Product requirements

### Getting Help

- Create an issue for bugs
- Start a discussion for questions
- Check existing documentation first

---

**Last Updated**: 2025-01-25 (Phase 1 + 2.1 + 2.2 + Logging Complete)
