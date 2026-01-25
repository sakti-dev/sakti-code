# IPC Bridge Implementation

## Overview

The IPC (Inter-Process Communication) bridge connects the Electron main process to the renderer process. This document explains the IPC architecture, channels implemented, and security considerations.

## Architecture

### Process Model

```
┌─────────────────────────────────────────┐
│      Renderer Process (UI)              │
│  ├─ SolidJS Application                 │
│  ├─ TanStack AI Chat Hook               │
│  └─ contextBridge (preload)            │
└─────────────┬───────────────────────────┘
              │ IPC (messages)
┌─────────────▼───────────────────────────┐
│         Main Process                     │
│  ├─ Hono Server                         │
│  ├─ Permission Manager                  │
│  └─ IPC Handlers                        │
└─────────────────────────────────────────┘
```

### Security Boundary

The IPC bridge is the **only** communication channel between renderer and main process.

**Renderer cannot**:

- Access Node.js APIs directly
- Access the filesystem
- Spawn processes
- Access Hono server directly

**Renderer can only**:

- Send IPC messages via preload bridge
- Receive IPC responses
- Use exposed APIs from preload

## Preload Bridge

### contextBridge

```typescript
// packages/desktop/src/preload/index.ts (future)
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ekacode", {
  getServerConfig: () => ipcRenderer.invoke("get-server-config"),

  onPermissionRequest: callback => {
    ipcRenderer.on("permission:request", (event, request) => {
      callback(request);
    });
  },

  sendPermissionResponse: response => {
    ipcRenderer.send("permission:response", response);
  },
});
```

**Why contextBridge?**

- Secure: Exposes only specific APIs
- Typed: Can add TypeScript definitions
- Isolated: Renderer cannot access ipcRenderer directly

### Security Configuration

```typescript
// packages/desktop/src/main/index.ts
webPreferences: {
  preload: join(__dirname, "../preload/index.js"),
  sandbox: false,           // Required for Node.js in main
  nodeIntegration: false,   // Prevent Node access in renderer
  contextIsolation: true,   // Required for contextBridge
}
```

**Why These Settings?**

| Setting            | Value   | Reason                      |
| ------------------ | ------- | --------------------------- |
| `nodeIntegration`  | `false` | Renderer cannot use Node.js |
| `contextIsolation` | `true`  | Isolate preload context     |
| `sandbox`          | `false` | Main process needs Node.js  |

## IPC Channels

### Server Configuration

**Channel**: `get-server-config`

**Direction**: Renderer → Main

**Purpose**: Get server URL and bearer token

```typescript
// Main process
ipcMain.handle("get-server-config", async () => {
  if (!serverConfig) {
    throw new Error("Server not initialized");
  }
  return {
    baseUrl: `http://127.0.0.1:${serverConfig.port}`,
    token: serverConfig.token,
  };
});

// Renderer process
const config = await window.ekacode.getServerConfig();
// { baseUrl: "http://127.0.0.1:54321", token: "..." }
```

**Why Not Return Directly?**

- Server starts asynchronously
- Config not ready until `app.whenReady()`
- Handler pattern ensures server is ready

### Permission Requests

**Channel**: `permission:request` (Main → Renderer)

**Direction**: Main → Renderer (event)

**Purpose**: Notify renderer of permission request

```typescript
// Main process
permissionMgr.on("permission:request", request => {
  mainWindow?.webContents.send("permission:request", request);
});

// Renderer process
window.ekacode.onPermissionRequest(request => {
  showApprovalDialog(request);
});
```

**Why Event, Not Handler?**

- Main process initiates (push model)
- Renderer polls or listens for events
- Multiple requests can be queued

### Permission Responses

**Channel**: `permission:response` (Renderer → Main)

**Direction**: Renderer → Main (one-way message)

**Purpose**: Send user's approval decision

```typescript
// Renderer process
window.ekacode.sendPermissionResponse({
  id: request.id,
  approved: true,
  patterns: ["*.ts"], // Optional: "always allow" patterns
});

// Main process
ipcMain.on("permission:response", (event, response) => {
  permissionMgr.handleResponse(response);
});
```

**Why One-Way Message?**

- Response is fire-and-forget
- No return value needed
- Faster than handler (no waiting)

### File Watcher Stubs

**Channels**: `fs:watch-start`, `fs:watch-stop`

**Direction**: Renderer → Main

**Purpose**: Control file watching (Phase 5 feature, currently stubs)

```typescript
// Main process (current implementation)
ipcMain.on("fs:watch-start", (event, workspacePath) => {
  // TODO: Implement chokidar watch in Phase 5
  console.log("Watch requested for:", workspacePath);
});

ipcMain.on("fs:watch-stop", () => {
  // TODO: Implement chokidar stop in Phase 5
  console.log("Watch stop requested");
});
```

**Future Implementation**:

```typescript
// Phase 5: Full implementation
import chokidar from "chokidar";

const watchers = new Map<string, FSWatcher>();

ipcMain.on("fs:watch-start", (event, workspacePath) => {
  const watcher = chokidar.watch(workspacePath, {
    ignored: /node_modules|\.git/,
    persistent: true,
  });

  watcher.on("all", (event, path) => {
    mainWindow?.webContents.send("fs:change", { event, path });
  });

  watchers.set(workspacePath, watcher);
});

ipcMain.on("fs:watch-stop", (event, workspacePath) => {
  const watcher = watchers.get(workspacePath);
  if (watcher) {
    await watcher.close();
    watchers.delete(workspacePath);
  }
});
```

## IPC Handler Pattern

### invoke vs send vs on

| Method               | Direction       | Returns | Use Case         |
| -------------------- | --------------- | ------- | ---------------- |
| `ipcRenderer.invoke` | Renderer → Main | Promise | Request-response |
| `ipcRenderer.send`   | Renderer → Main | None    | One-way messages |
| `webContents.send`   | Main → Renderer | None    | Push events      |
| `ipcRenderer.on`     | Renderer ← Main | None    | Listen to events |

### When to Use Each

```typescript
// invoke: Request-response
const config = await ipcRenderer.invoke("get-server-config");

// send: One-way message (no response needed)
ipcRenderer.send("permission:response", { id, approved: true });

// webContents.send: Main pushes to renderer
mainWindow.webContents.send("permission:request", request);

// on: Renderer listens for events
ipcRenderer.on("permission:request", (event, request) => {
  // Handle request
});
```

## Error Handling

### IPC Errors

```typescript
// Main process: Throw errors
ipcMain.handle("get-server-config", async () => {
  if (!serverConfig) {
    throw new Error("Server not initialized");
  }
  return serverConfig;
});

// Renderer process: Catch errors
try {
  const config = await window.ekacode.getServerConfig();
} catch (error) {
  console.error("Failed to get server config:", error.message);
}
```

### Timeout Handling

```typescript
// Renderer: Add timeout to IPC calls
async function getServerConfigWithTimeout() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const config = await window.ekacode.getServerConfig();
    clearTimeout(timeout);
    return config;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Timeout getting server config");
    }
    throw error;
  }
}
```

## Type Safety

### TypeScript Definitions

```typescript
// packages/desktop/src/preload/index.d.ts (future)
interface EkacodeAPI {
  getServerConfig(): Promise<{
    baseUrl: string;
    token: string;
  }>;

  onPermissionRequest(callback: (request: PermissionRequest) => void): void;

  sendPermissionResponse(response: PermissionResponse): void;
}

declare global {
  interface Window {
    ekacode: EkacodeAPI;
  }
}
```

**Benefits**:

- Autocomplete in renderer
- Type checking across IPC boundary
- Documentation via types

## Security Considerations

### Input Validation

```typescript
// Main process: Validate all inputs
ipcMain.handle("fs:watch-start", (event, workspacePath) => {
  // Validate path
  if (typeof workspacePath !== "string") {
    throw new Error("Invalid path");
  }

  // Resolve and validate
  const absolutePath = path.resolve(workspacePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error("Path does not exist");
  }

  // Start watcher
  startWatcher(absolutePath);
});
```

### Message Source Validation

```typescript
// Main process: Verify message source
ipcMain.on("permission:response", (event, response) => {
  // Verify sender is renderer
  if (!event.sender.isDestroyed()) {
    permissionMgr.handleResponse(response);
  }
});
```

### Sensitive Data

**Never expose via IPC**:

- File contents (use server API instead)
- User's API keys (use keytar/credential manager)
- Server token only sent once at startup

**Safe to expose**:

- Server configuration (URL + token for session)
- Permission requests (metadata only)
- File change events (paths only, not contents)

## Performance

### Lazy Loading

```typescript
// Load heavy modules only when needed
let chokidar: typeof import("chokidar");

ipcMain.on("fs:watch-start", async (event, path) => {
  if (!chokidar) {
    chokidar = await import("chokidar");
  }
  // Use chokidar...
});
```

### Debouncing

```typescript
// Debounce file change events
const debounceMap = new Map<string, NodeJS.Timeout>();

watcher.on("all", (event, path) => {
  const key = `${event}:${path}`;
  clearTimeout(debounceMap.get(key));

  debounceMap.set(
    key,
    setTimeout(() => {
      mainWindow?.webContents.send("fs:change", { event, path });
      debounceMap.delete(key);
    }, 100)
  );
});
```

## Testing

### Unit Tests

```typescript
describe("IPC handlers", () => {
  let mainWindow: BrowserWindow;
  let ipcMain: IpcMain;

  beforeEach(() => {
    mainWindow = new BrowserWindow({ show: false });
    ipcMain = new IpcMain();
    registerHandlers(ipcMain);
  });

  it("should return server config", async () => {
    const result = await ipcMain.invoke("get-server-config");
    expect(result).toHaveProperty("baseUrl");
    expect(result).toHaveProperty("token");
  });
});
```

### Integration Tests

```typescript
describe("IPC communication", () => {
  it("should handle permission flow", async () => {
    const request = {
      id: "test-1",
      permission: "edit",
      patterns: ["/test/file.ts"],
      always: [],
      sessionID: "session-1",
    };

    // Send request
    mainWindow.webContents.send("permission:request", request);

    // Wait for UI response
    const response = await waitForPermissionResponse();

    // Verify handled
    expect(permissionMgr.getPendingRequests()).toHaveLength(0);
  });
});
```

## Future Enhancements

### Typed IPC

```typescript
// Future: Use @electron-toolkit/preload for typed IPC
import { exposeElectronAPI } from "@electron-toolkit/preload";

exposeElectronAPI({
  getServerConfig: () => ipcRenderer.invoke("get-server-config"),
  // Automatically typed!
});
```

### Message Queue

```typescript
// Future: Queue messages for offline support
const messageQueue: Message[] = [];

function queueMessage(message: Message) {
  messageQueue.push(message);
  processQueueWhenOnline();
}
```

### Broadcast Channels

```typescript
// Future: Broadcast to multiple windows
ipcMain.on("permission:request", (event, request) => {
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send("permission:request", request);
  });
});
```

---

_Updated: 2025-01-25_
