# Logging Architecture

## Overview

ekacode uses a centralized logging infrastructure built on **Pino** that provides structured JSON logging with searchable prefixes across all packages.

## Logger Package

**Location**: `packages/logger/`

**Import**:

```typescript
import { createLogger } from "@ekacode/logger";

// Create package-level logger
const logger = createLogger("ekacode");

// Basic usage
logger.info("Message");
logger.warn("Warning message");
logger.error("Error occurred", error, { context: "data" });

// Create child logger with additional context
const toolLogger = logger.child({ module: "tool:read", tool: "read" });
toolLogger.debug("Reading file", { path: "/path/to/file" });
```

## Log Prefix Format

All logs include a searchable prefix in the format: `[package:module]` or `[package]`

### Package Prefixes

| Prefix      | Package          | Description          |
| ----------- | ---------------- | -------------------- |
| `[ekacode]` | @ekacode/ekacode | Core ekacode package |
| `[server]`  | @ekacode/server  | Hono server          |
| `[desktop]` | @ekacode/desktop | Electron desktop app |

### Module Prefixes

| Full Prefix                | Module            | Use Cases                     |
| -------------------------- | ----------------- | ----------------------------- |
| `[ekacode:tool:read]`      | File read tool    | File reading operations       |
| `[ekacode:tool:write]`     | File write tool   | File writing operations       |
| `[ekacode:tool:edit]`      | File edit tool    | File editing operations       |
| `[ekacode:tool:multiedit]` | Multi-edit tool   | Batch file edits              |
| `[ekacode:tool:glob]`      | Glob tool         | File pattern matching         |
| `[ekacode:tool:ls]`        | List tool         | Directory listings            |
| `[ekacode:agent]`          | Agent lifecycle   | Agent start/stop/events       |
| `[ekacode:permissions]`    | Permission system | Permission requests/approvals |
| `[server:api]`             | API requests      | HTTP request/response         |
| `[server:api:auth]`        | Authentication    | Auth attempts/failures        |
| `[server:permissions]`     | Permission API    | Permission endpoints          |
| `[desktop:ipc]`            | IPC communication | Main-renderer messaging       |
| `[desktop:server]`         | Server management | Server lifecycle              |
| `[desktop:lifecycle]`      | App lifecycle     | App startup/shutdown          |

## Log Levels

| Level    | Value | Usage                                |
| -------- | ----- | ------------------------------------ |
| `debug`  | 30    | Detailed diagnostics, development    |
| `info`   | 40    | General informational messages       |
| `warn`   | 50    | Warning conditions, potential issues |
| `error`  | 60    | Error conditions, exceptions         |
| `silent` | ∞     | Disable logging                      |

## Searching Logs

### By Package

```bash
# All ekacode logs
grep "[ekacode]" logs/ekacode.log

# All server logs
grep "[server]" logs/server.log

# All desktop logs
grep "[desktop]" logs/desktop.log
```

### By Module

```bash
# File read operations
grep "[ekacode:tool:read]" logs/ekacode.log

# Permission requests
grep "[ekacode:permissions]" logs/ekacode.log
grep "[server:permissions]" logs/server.log

# API requests
grep "[server:api]" logs/server.log

# IPC messages
grep "[desktop:ipc]" logs/desktop.log
```

### By Context

```bash
# Specific session
grep "sessionID:abc123" logs/ekacode.log

# Specific file path
grep 'path: "/path/to/file"' logs/ekacode.log

# Permission approved
grep "approved: true" logs/ekacode.log

# Permission denied
grep "approved: false" logs/ekacode.log
```

### By Level

```bash
# Errors only
grep '"level":"error"' logs/*.log

# Warnings and errors
grep -E '"level":"(warn|error)"' logs/*.log
```

## Configuration

### Environment Variables

```bash
# Global log level
LOG_LEVEL=info

# Package-specific overrides
LOG_LEVEL_EKACODE=debug
LOG_LEVEL_SERVER=info
LOG_LEVEL_DESKTOP=warn

# File logging (production)
NODE_ENV=production
LOG_FILE_PATH=./logs/ekacode.log
```

### Default Configuration

```typescript
export function getDefaultConfig(): LoggerConfig {
  return {
    level: (process.env.LOG_LEVEL as LogLevel) || "info",
    prettyPrint: process.env.NODE_ENV !== "production",
    fileOutput: process.env.NODE_ENV === "production",
    filePath: process.env.LOG_FILE_PATH,
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "apiKey",
      "token",
      "password",
      "secret",
    ],
  };
}
```

## Log Context Properties

| Property    | Type     | Description                             |
| ----------- | -------- | --------------------------------------- |
| `package`   | string   | Package name (ekacode, server, desktop) |
| `module`    | string   | Module name (tool:read, api:auth, etc.) |
| `sessionId` | string   | Request/session ID for tracing          |
| `agent`     | string   | Agent name (when applicable)            |
| `tool`      | string   | Tool name (when applicable)             |
| `requestId` | string   | API request ID (server)                 |
| `duration`  | number   | Operation duration in ms                |
| `status`    | number   | HTTP status code (server)               |
| `path`      | string   | File path (filesystem tools)            |
| `approved`  | boolean  | Permission approval result              |
| `patterns`  | string[] | Permission patterns                     |
| `err`       | object   | Error details (name, message, stack)    |

## Output Format

### Development (Pretty Print)

```
[12:34:56] [ekacode:tool:read] Reading file
    level: "debug"
    path: "src/index.ts"
    sessionId: "abc123"

[12:34:57] [ekacode:tool:read] File read successfully
    level: "info"
    path: "src/index.ts"
    lineCount: 42
    truncated: false
```

### Production (JSON)

```json
{
  "level": 30,
  "time": "2025-01-25T12:34:56.789Z",
  "prefix": "[ekacode:tool:read]",
  "package": "ekacode",
  "module": "tool:read",
  "tool": "read",
  "sessionId": "abc123",
  "path": "src/index.ts",
  "msg": "Reading file"
}
```

## Agent Search Guide

When searching for specific issues:

### File Operation Issues

```bash
# Find all file operations on a specific file
grep 'path: "src/config.ts"' logs/ekacode.log

# Find permission denials
grep -A 5 'approved: false' logs/ekacode.log

# Find binary file rejections
grep "Binary file detected" logs/ekacode.log
```

### Permission Issues

```bash
# Find pending permission requests
grep "Requesting user approval" logs/ekacode.log

# Find timeout denials
grep "Permission request timed out" logs/ekacode.log

# Find pattern caching
grep "Auto-approved by cached pattern" logs/ekacode.log
```

### API Issues

```bash
# Find failed requests
grep '"status": 4' logs/server.log
grep '"status": 5' logs/server.log

# Find unauthorized attempts
grep "Unauthorized access attempt" logs/server.log

# Find slow requests (>1000ms)
grep '"duration": [1-9][0-9][0-9][0-9]' logs/server.log
```

### Desktop Issues

```bash
# Find server startup failures
grep "Failed to start server" logs/desktop.log

# Find IPC errors
grep "error" logs/desktop.log | grep "desktop:ipc"
```

## Integration Guide

### Adding Logging to New Tools

```typescript
import { createLogger } from "@ekacode/logger";

const logger = createLogger("ekacode");

export const myTool = createTool({
  id: "my-tool",
  description: "My tool description",

  execute: async (args, context) => {
    const sessionID = (context as { sessionID?: string })?.sessionID || nanoid();
    const toolLogger = logger.child({
      module: "tool:mytool",
      tool: "mytool",
      sessionID,
    });

    toolLogger.debug("Tool execution started", { args });

    try {
      // ... tool logic

      toolLogger.info("Tool execution completed", { result });
      return result;
    } catch (error) {
      toolLogger.error("Tool execution failed", error as Error);
      throw error;
    }
  },
});
```

## See Also

- **[Logger README](../../packages/logger/README.md)** - Package documentation
- **[Permission System](./security.md)** - Permission request logging
- **[Tool Infrastructure](../phase-2-tools/tool-infrastructure.md)** - Tool execution logging
