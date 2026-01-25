# Shared Type System

## Overview

The `@ekacode/shared` package contains all shared TypeScript types and interfaces used across the ekacode monorepo. This document explains the type system design and why certain types are centralized.

## Design Philosophy

### Why Shared Types?

1. **Type Safety Across Packages**: Ensure type compatibility when data crosses package boundaries
2. **Single Source of Truth**: One definition for each type, prevents drift
3. **Documentation**: Types serve as executable documentation
4. **Refactoring Safety**: Changing a type propagates to all consumers via TypeScript

### Type Organization Principles

- **Domain-Driven**: Types grouped by domain (workspace, session, permissions)
- **Minimal Dependencies**: No imports from other packages
- **Serializable**: All types designed to be JSON-serializable for IPC
- **Versioned**: Types versioned with the package (`0.0.1` currently)

## Core Types

### Workspace Types

```typescript
// packages/shared/src/types.ts

export interface WorkspaceConfig {
  root: string; // Absolute path to workspace root
  worktree?: string; // Optional worktree path (Git worktrees)
}
```

**Why This Design**:

- `root`: Required - every agent needs a workspace root
- `worktree`: Optional - Git worktree support for advanced workflows
- String paths: Cross-platform, Node.js `path` module handles differences

**Use Cases**:

- Initialize `WorkspaceInstance` singleton
- Pass workspace configuration between processes
- Store user workspace preferences

### Session Context

```typescript
export interface SessionContext {
  sessionID: string; // Unique identifier for session
  messageID: string; // Unique identifier for message
  agent: string; // Agent identifier (e.g., "coder-agent")
  abort?: AbortSignal; // Optional cancellation signal
}
```

**Why This Design**:

- `sessionID`: Correlate all actions in a conversation
- `messageID`: Track individual tool calls
- `agent`: Support multiple agents with different capabilities
- `abort`: Allow user to cancel long-running operations

**Use Cases**:

- Tool execution context
- Permission request tracking
- Agent response streaming

### Permission Types

```typescript
export type PermissionType = "read" | "edit" | "external_directory" | "bash";

export interface PermissionRequest {
  id: string; // Unique request ID
  permission: PermissionType; // Type of permission
  patterns: string[]; // Affected file/command patterns
  always: string[]; // Pre-approved patterns
  sessionID: string; // Session for approval caching
  metadata?: Record<string, unknown>; // Additional context (diff, etc.)
}

export interface PermissionResponse {
  id: string; // Matches request ID
  approved: boolean; // Approval decision
  patterns?: string[]; // Approved patterns (for "always allow")
}
```

**Why This Design**:

- `PermissionType`: Union type for type-safe permission checking
- `patterns`: Array to support batch operations (e.g., multiedit)
- `always`: Support for "remember my choice" functionality
- `metadata`: Flexible context for UI (show diffs, explain operations)

**Use Cases**:

- Tool permission requests
- UI approval dialogs
- Permission caching across session

## Type Usage Patterns

### Import Pattern

```typescript
// In other packages
import type { WorkspaceConfig, SessionContext } from "@ekacode/shared";
import type { PermissionRequest, PermissionResponse } from "@ekacode/shared";
```

### Type Guards

```typescript
function isPermissionRequest(obj: unknown): obj is PermissionRequest {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    "permission" in obj &&
    "patterns" in obj
  );
}
```

### Type Narrowing

```typescript
function handlePermission(data: PermissionRequest | PermissionResponse) {
  if ("approved" in data) {
    // It's a PermissionResponse
    console.log(data.approved);
  } else {
    // It's a PermissionRequest
    console.log(data.permission);
  }
}
```

## IPC Serialization

All types are designed to be JSON-serializable for Electron IPC:

```typescript
// Main process
ipcMain.handle("get-workspace", async () => {
  return { root: "/path/to/workspace" } as WorkspaceConfig;
});

// Renderer process
const config = await ipcRenderer.invoke("get-workspace");
// config is typed as WorkspaceConfig
```

## Extension Points

### Adding New Permission Types

```typescript
// Step 1: Update the union type
export type PermissionType = "read" | "edit" | "external_directory" | "bash" | "network"; // New type

// Step 2: Update PermissionManager to handle new type
// packages/ekacode/src/security/permission-manager.ts
```

### Adding Session Metadata

```typescript
// Extended session context for specific use cases
export interface ExtendedSessionContext extends SessionContext {
  userID?: string; // For multi-user support
  telemetry?: boolean; // For analytics
}
```

## Type Evolution Strategy

### Backward Compatibility

When evolving types:

1. **Add optional fields**: Safe for existing consumers
2. **Add union members**: Use discriminated unions
3. **Never remove fields**: Mark as deprecated instead

```typescript
// Good: Adding optional field
export interface SessionContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort?: AbortSignal;
  userID?: string; // New optional field
}

// Avoid: Removing fields
export interface SessionContext {
  // abort?: AbortSignal;  // DON'T REMOVE - breaks consumers
}
```

### Versioning

Current version: `0.0.1` (development)

Version bump criteria:

- **Patch (0.0.2)**: Add optional fields, fix types
- **Minor (0.1.0)**: Add new types, breaking changes
- **Major (1.0.0)**: Stable API, public release

## TypeScript Configuration

The shared package uses strict TypeScript settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

**Why Strict Mode**:

- Catches more errors at compile time
- Forces explicit type definitions
- Prevents `undefined` and `null` bugs
- Better IDE autocomplete

## Best Practices

### DO:

✅ Use shared types for all cross-package interfaces
✅ Add JSDoc comments for complex types
✅ Create discriminated unions for related types
✅ Use `type` for unions, `interface` for objects

### DON'T:

❌ Create duplicate types in other packages
❌ Use `any` - use `unknown` with type guards
❌ Mix concerns (keep types focused)
❌ Export implementation details

## Troubleshooting

### Type Errors Across Packages

**Symptom**: "Cannot find type" after adding to shared

**Cause**: TypeScript cache or pnpm not linked

**Fix**:

```bash
pnpm install
pnpm --filter @ekacode/shared typecheck
```

### Circular Type Dependencies

**Symptom**: "Type X circularly references itself"

**Cause**: Type in shared depends on type in another package

**Fix**: Move dependent type to shared, or use interface segregation

---

_Updated: 2025-01-25_
