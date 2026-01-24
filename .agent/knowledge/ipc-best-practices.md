Electron IPC usually feels “hard” for two reasons:

1. people mix **security concerns** (Node access in the renderer) with “how do I call a function?”
2. IPC channels get messy fast (stringly-typed channels + scattered listeners + no clear contract)

A clean, robust approach is to treat IPC like an **internal HTTP API**:

- **Main process** = backend (privileged, owns OS access)
- **Renderer (Solid)** = frontend (unprivileged UI)
- **Preload** = the _only_ trusted “API gateway” between them (exposes a small, typed surface)

Below are best practices + a concrete pattern you can copy.

---

## 1) Start with a secure baseline (it also makes IPC clearer)

In 2026 Electron, the recommended model is: **no Node in renderer**, **context isolation on**, and bridge only what you need through **preload**. Electron explicitly recommends using `contextIsolation`, and not relying only on `nodeIntegration: false`. ([Electron][1])

A solid baseline when creating your window:

```ts
// main/window.ts
import { BrowserWindow } from "electron";
import path from "node:path";

export function createMainWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false, // make explicit even if default
      contextIsolation: true, // recommended security boundary
      sandbox: true, // sandboxing is recommended and default since Electron 20
    },
  });

  return win;
}
```

Notes:

- `nodeIntegration` is **false by default**, but set it explicitly so nobody “fixes” it later. ([Electron][2])
- Electron’s security guide calls out that proper isolation needs `contextIsolation`. ([Electron][1])
- Sandboxing is recommended and Electron notes it as default since 20.0.0. ([Electron][1])

---

## 2) Pick one IPC style for 90% of calls: `invoke/handle` (RPC)

For “call function → get result”, use:

- `ipcRenderer.invoke(...)` in preload/renderer side
- `ipcMain.handle(...)` in main side

Electron’s IPC tutorial demonstrates this as a primary pattern. ([Electron][3])

Also, Electron documents that `invoke` arguments/results use the **Structured Clone Algorithm** (no prototype chains; functions/promises/symbols will throw; some DOM types can’t be sent to main). This affects how you design payloads. ([Electron][4])

**Rule of thumb:** If you find yourself using `send` + `on` + “reply” channels for request/response… stop and replace it with `invoke/handle`.

---

## 3) Don’t expose raw `ipcRenderer` to the renderer

Electron’s `contextBridge` docs explicitly warn that exposing `ipcRenderer` as-is is a security footgun (and sending the whole module over the bridge doesn’t work the way people expect). ([Electron][5])

So your preload should expose a **small API object**, not a generic “invoke any channel” pipe.

---

## 4) Recommended project structure for clean IPC

A structure that stays maintainable:

```
src/
  main/
    main.ts
    ipc/
      index.ts           (register all handlers)
      settings.ipc.ts
      files.ipc.ts
  preload/
    index.ts             (expose typed API)
  renderer/
    app.tsx              (Solid)
    services/electron.ts (thin wrapper)
  shared/
    ipc.ts               (channel constants + shared types)
```

Key ideas:

- **shared/ipc.ts** is the single source of truth for channel names + payload types
- **main/ipc/** registers handlers (no UI code)
- **preload/** exposes a “frontend-friendly” API (no Electron types leak to Solid)
- **renderer/** never imports Electron

---

## 5) Concrete, robust IPC pattern (TypeScript)

### A) Define channels + types in `shared/ipc.ts`

```ts
// shared/ipc.ts
export const IPC = {
  settings: {
    get: "settings:get",
    set: "settings:set",
    changed: "settings:changed",
  },
  dialog: {
    pickFile: "dialog:pickFile",
  },
} as const;

export type Settings = {
  theme: "light" | "dark";
  autoLaunch: boolean;
};

export type IpcHandlers = {
  [IPC.settings.get]: {
    req: void;
    res: Settings;
  };
  [IPC.settings.set]: {
    req: Partial<Settings>;
    res: Settings;
  };
  [IPC.dialog.pickFile]: {
    req: { title?: string };
    res: { path: string | null };
  };
};

export type IpcChannel = keyof IpcHandlers;
```

### B) Main process: register handlers in one place

```ts
// main/ipc/index.ts
import { ipcMain } from "electron";
import { registerSettingsIpc } from "./settings.ipc";
import { registerDialogIpc } from "./dialog.ipc";

export function registerIpcHandlers() {
  registerSettingsIpc(ipcMain);
  registerDialogIpc(ipcMain);
}
```

Example handler module:

```ts
// main/ipc/settings.ipc.ts
import type { IpcMain } from "electron";
import { IPC, type Settings } from "../../shared/ipc";

const store: Settings = { theme: "dark", autoLaunch: false };

export function registerSettingsIpc(ipcMain: IpcMain) {
  // Dev HMR / reload safety: avoid "Attempted to register a second handler..."
  ipcMain.removeHandler(IPC.settings.get);
  ipcMain.removeHandler(IPC.settings.set);

  ipcMain.handle(IPC.settings.get, async () => {
    return store;
  });

  ipcMain.handle(IPC.settings.set, async (_event, patch: Partial<Settings>) => {
    Object.assign(store, patch);
    return store;
  });
}
```

This `removeHandler` approach prevents duplicate handler errors during dev reloads. Electron documents `removeHandler` and `handleOnce`. ([Electron][6])

### C) Main → renderer events (push updates)

For “push” events, use `webContents.send` from main, and subscribe in preload/renderer. (This is the right place for `send/on`.)

You might broadcast when settings change:

```ts
// main/broadcast.ts
import { BrowserWindow } from "electron";
import { IPC, type Settings } from "../shared/ipc";

export function broadcastSettingsChanged(next: Settings) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.settings.changed, next);
  }
}
```

### D) Preload: expose a _typed_ API via `contextBridge`

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type Settings } from "../shared/ipc";

type Unsubscribe = () => void;

const api = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settings.get),
    set: (patch: Partial<Settings>) =>
      ipcRenderer.invoke(IPC.settings.set, patch),

    onChanged: (cb: (next: Settings) => void): Unsubscribe => {
      const listener = (_event: Electron.IpcRendererEvent, next: Settings) =>
        cb(next);
      ipcRenderer.on(IPC.settings.changed, listener);
      return () => ipcRenderer.removeListener(IPC.settings.changed, listener);
    },
  },

  dialog: {
    pickFile: (opts?: { title?: string }) =>
      ipcRenderer.invoke(IPC.dialog.pickFile, opts ?? {}),
  },
};

contextBridge.exposeInMainWorld("api", api);
```

This aligns with Electron’s recommendation to use `contextBridge` with context isolation enabled. ([Electron][7])

Also note: `ipcRenderer.invoke` payloads must be cloneable; don’t send DOM objects, functions, etc. ([Electron][4])

### E) Renderer (Solid): wrap it cleanly + use Solid lifecycle to avoid leaks

Add a global type (so you don’t have `any` everywhere):

```ts
// renderer/global.d.ts
export {};

declare global {
  interface Window {
    api: {
      settings: {
        get: () => Promise<import("../shared/ipc").Settings>;
        set: (
          patch: Partial<import("../shared/ipc").Settings>
        ) => Promise<import("../shared/ipc").Settings>;
        onChanged: (
          cb: (next: import("../shared/ipc").Settings) => void
        ) => () => void;
      };
      dialog: {
        pickFile: (opts?: {
          title?: string;
        }) => Promise<{ path: string | null }>;
      };
    };
  }
}
```

Now in Solid:

```tsx
// renderer/App.tsx
import { createResource, onCleanup, createSignal } from "solid-js";

export function App() {
  const [settings, { mutate, refetch }] = createResource(() =>
    window.api.settings.get()
  );
  const [filePath, setFilePath] = createSignal<string | null>(null);

  const off = window.api.settings.onChanged((next) => {
    // keep UI in sync without refetching if you already have the new value
    mutate(next);
  });
  onCleanup(off);

  const pick = async () => {
    const { path } = await window.api.dialog.pickFile({ title: "Pick a file" });
    setFilePath(path);
  };

  return (
    <div>
      <button onClick={pick}>Pick file</button>
      <div>Picked: {filePath() ?? "(none)"}</div>
      <div>Theme: {settings()?.theme ?? "loading..."}</div>
      <button onClick={() => window.api.settings.set({ theme: "light" })}>
        Light
      </button>
      <button onClick={() => window.api.settings.set({ theme: "dark" })}>
        Dark
      </button>
    </div>
  );
}
```

This avoids the classic IPC memory leak: “I subscribed but never unsubscribed”.

---

## 6) Error handling: don’t rely on thrown Errors crossing IPC

Electron notes that errors thrown in `ipcMain.handle` get **serialized**, and the renderer won’t receive the full original error transparently (often only `message`). ([Electron][6])

For robust apps, I recommend returning a Result type instead of throwing:

```ts
// shared/result.ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string } };
```

Then in main:

```ts
ipcMain.handle(IPC.settings.set, async (_e, patch) => {
  try {
    Object.assign(store, patch);
    return { ok: true, data: store } as const;
  } catch (err) {
    return {
      ok: false,
      error: { message: err instanceof Error ? err.message : "Unknown error" },
    } as const;
  }
});
```

And in renderer you handle it explicitly (no surprise rejected promises with incomplete info).

---

## 7) Common IPC “gotchas” and how to avoid them

### Don’t use sync IPC

`ipcRenderer.sendSync` blocks the renderer; Electron warns it should be a last resort and async is preferred. ([Electron][4])

### Be careful with payload types

Since IPC uses structured clone, prototypes don’t survive and some objects can’t be sent at all. Keep payloads to plain data (objects/arrays/strings/numbers/buffers), or pass file paths and read in main. ([Electron][4])

### Avoid “string soup” channel names

Use a single `IPC` constant object and import it everywhere (like above). This alone removes a lot of mental load.

### Prevent duplicate handler registration in dev

Use `ipcMain.removeHandler(channel)` before `handle` when you have hot reload / re-registering logic. ([Electron][6])

### Treat IPC as a boundary

Even if you only load local UI, this mindset keeps your code cleaner: validate inputs, keep the API narrow, and avoid exposing “do anything” primitives.

---

## 8) Tooling note for Solid + Electron

A lot of people use Vite-based setups (fast HMR) and manage main/preload/renderer builds separately. There are Solid+Electron boilerplates you can reference (example: `ch99q/vite-solid-electron`). ([GitHub][8])
If you go the `electron-vite` route, their guide also explicitly discusses preload bridging patterns and recommends tooling around preload exposure. ([Electron Vite][9])

(You don’t _need_ these tools to do clean IPC, but they reduce friction.)

---

## A simple checklist you can follow

- ✅ Renderer (Solid) never imports Electron
- ✅ All privileged APIs live in main
- ✅ Preload exposes a _small_, typed API object via `contextBridge`
- ✅ Use `invoke/handle` for request/response
- ✅ Use `send/on` only for events (push), with unsubscribe functions
- ✅ Centralize channel names + types in `shared/`
- ✅ Use Result types (or a consistent error envelope) instead of relying on thrown errors crossing IPC

---

If you tell me what kinds of features you’re building (filesystem access, tray, auto-update, DB, background tasks, etc.), I can sketch an IPC “module layout” (channels + API shape) that stays clean as your app grows.

[1]: https://www.electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com "Security - Electron"
[2]: https://www.electronjs.org/docs/latest/api/structures/web-preferences?utm_source=chatgpt.com "WebPreferences Object - Electron"
[3]: https://www.electronjs.org/docs/latest/tutorial/ipc?utm_source=chatgpt.com "Inter-Process Communication - Electron"
[4]: https://www.electronjs.org/docs/latest/api/ipc-renderer?utm_source=chatgpt.com "ipcRenderer - Electron"
[5]: https://www.electronjs.org/docs/latest/api/context-bridge?utm_source=chatgpt.com "contextBridge - Electron"
[6]: https://www.electronjs.org/docs/latest/api/ipc-main?utm_source=chatgpt.com "ipcMain - Electron"
[7]: https://www.electronjs.org/docs/latest/tutorial/context-isolation?utm_source=chatgpt.com "Context Isolation - Electron"
[8]: https://github.com/ch99q/vite-solid-electron?utm_source=chatgpt.com "ch99q/vite-solid-electron: ⚡️ Vite + SolidJS - GitHub"
[9]: https://electron-vite.org/guide/dev?utm_source=chatgpt.com "Development - electron-vite"
