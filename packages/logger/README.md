# @ekacode/logger

Centralized logging infrastructure using Pino for the ekacode monorepo.

## Features

- Structured JSON logging with agent-searchable prefixes
- File output (rotating logs) + console (dev mode)
- Request/session context tracking
- Package-level prefixes ([ekacode], [server], [desktop])
- Configurable log levels via environment variables

## Usage

```typescript
import { createLogger } from "@ekacode/logger";

// Create a logger for your package
const logger = createLogger("ekacode");

// Basic logging
logger.info("Application started");
logger.warn("Configuration issue detected");
logger.error("Operation failed", new Error("Something went wrong"));

// Add context
logger.info("Tool execution started", {
  module: "tool:read",
  sessionId: "req-123",
  tool: "read",
});

// Create child logger with additional context
const toolLogger = logger.child({ module: "tool:read", tool: "read" });
toolLogger.debug("Reading file", { path: "/path/to/file" });
```

## Prefix Format

The prefix format enables agent searching:

```
[ekacode:tool:read]  - File read operations
[ekacode:tool:write] - File write operations
[ekacode:agent]      - Agent lifecycle
[server:api]         - API requests
[server:permissions] - Permission system
[desktop:ipc]        - IPC communication
[desktop:server]     - Server management
```

## Environment Variables

- `LOG_LEVEL` - Global log level (debug, info, warn, error, silent)
- `LOG_LEVEL_EKACODE` - ekacode package log level override
- `LOG_LEVEL_SERVER` - Server package log level override
- `LOG_LEVEL_DESKTOP` - Desktop package log level override
- `NODE_ENV` - Set to 'production' for file logging
- `LOG_FILE_PATH` - Custom log file path (production mode)

## Configuration

```typescript
import { createLogger, getDefaultConfig } from "@ekacode/logger";

const config = getDefaultConfig();
config.level = "debug";
config.prettyPrint = true;

const logger = createLogger("mypackage", config);
```
