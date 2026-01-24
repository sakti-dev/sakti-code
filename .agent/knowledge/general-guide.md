Below is a **build guide written for an AI coding agent** (or for you to follow manually) to implement a **local-first “coding agent” desktop app** using:

- **Electron** (desktop shell + security boundary)
- **Mastra** (agent/workflow/tool orchestration)
- **Hono** (internal HTTP API gateway inside the Electron main process)
- **SolidJS** (renderer UI)
- **TanStack AI** (headless chat state + streaming consumer in the UI)

It compiles the core conclusions from your research, but also tightens a few details so the implementation is actually robust + clean.

---

# Blueprint: Electron Coding Agent with Mastra + Hono + SolidJS + TanStack AI

## 1) What you are building

A desktop coding agent that:

- Streams assistant output (fast token streaming + large code blocks)
- Runs long tools (shell commands, npm install, git, tests) with streaming logs
- Reads/writes files in a workspace (and can preview diffs)
- Supports cancellation (“Stop”) cleanly
- Supports tool approval for risky operations (write/delete/run)

The core constraint: **Renderer must remain unprivileged** (no Node access), while **Main process owns all privileged operations**.

---

## 2) The architecture decision (the heart of your research)

### Use HTTP/SSE (Hono on localhost) for “agent traffic”

You want the high-volume, streaming, long-running stuff to go over **standard web streaming**.

Why:

- Electron IPC message payloads must be “structured clone” serializable; complex streaming types aren’t a natural fit for IPC. ([Electron][1])
- Hono is Fetch/Request/Response-native and supports streaming (including SSE helpers). ([GitHub][2])
- TanStack AI’s client is explicitly built around **SSE connection adapters** and supports auth headers + dynamic options. ([TanStack][3])

### Keep IPC _minimal_ for “desktop-native push events”

IPC remains very useful for:

- passing server config (port + token) into renderer
- file watcher push events (OS-level changes)
- window controls (minimize/maximize), dialogs, etc.

And it stays clean because it’s **small, typed, and boring**.

---

## 3) Process boundaries (clean code starts here)

### Renderer (SolidJS + TanStack AI)

- No Node
- Uses:

  - **HTTP** (`fetchServerSentEvents`) to talk to the local Hono server for chat + streaming
  - **IPC bridge** for config and FS events

### Main process (Electron)

- Runs:

  - Hono server (localhost only)
  - Mastra runtime (agents/tools/workflows)
  - filesystem access + process spawning
  - file watchers (then pushes events via IPC)

### Preload (security boundary)

- Exposes a tiny, whitelisted API to the renderer via `contextBridge`
- Never exposes raw `ipcRenderer` directly ([Black Hat][4])

---

## 4) Compatibility reality check: Mastra streaming vs TanStack AI streaming

Your research is correct about **transport** (SSE/HTTP is ideal), but there’s a subtle point:

- **TanStack AI `useChat` expects TanStack AI “StreamChunks”** (a specific JSON protocol). ([TanStack][5])
- **Mastra `.stream()` emits Mastra streaming events** like `text-delta`, `tool-call`, `tool-result`, `finish`, etc. ([Mastra][6])

So the best practice is:

### ✅ Add a “protocol bridge” endpoint

Create a custom Hono route like `POST /api/chat` that:

1. Calls `mastraAgent.stream(...)`
2. Maps Mastra events to TanStack AI StreamChunks
3. Emits TanStack AI StreamChunks as SSE

This preserves the clean “TanStack `fetchServerSentEvents` happy path” in the UI while keeping Mastra in charge of the agent/tool orchestration.

---

## 5) Security model (must-have for localhost server)

A localhost server is not automatically safe. Secure it:

1. **Random port** (or port `0` to let OS assign)
2. **Ephemeral auth token** generated at startup
3. **Bind to loopback only** (127.0.0.1 / ::1)
4. **Reject any request missing `Authorization: Bearer <token>`**
5. Consider:

   - strict `Host` validation (DNS rebinding mitigation)
   - strict `Origin` checks / CORS allowlist

Electron renderer security:

- `contextIsolation: true`
- `nodeIntegration: false`
- follow Electron security checklist (CSP, no remote content, etc.) ([Black Hat][4])

---

## 6) Recommended repo structure (clean boundaries)

Keep “main runtime” separate from “renderer UI” so you don’t accidentally import privileged modules into UI:

```
src/
  main/
    index.ts
    window.ts
    server/
      start.ts
      app.ts
      auth.ts
      routes/
        chat.ts           # Mastra -> TanStack chunk bridge (SSE)
        mastra.ts         # optional: MastraServer init (/api/agents/*)
        system.ts         # status, settings, etc.
      mastra/
        instance.ts
        agents/
          coder.ts
        tools/
          fs.ts
          shell.ts
      fs/
        watch.ts
  preload/
    index.ts
  renderer/
    App.tsx
    chat/
      ChatView.tsx
    lib/
      config.ts
      api.ts
      ipc.ts
```

Rule: **renderer cannot import `src/main/**` at runtime\*\* (types are okay if separated or type-only imports).

---

## 7) Streaming contracts (what you emit + what you consume)

### TanStack AI StreamChunk protocol (target format)

TanStack AI defines chunk structures like:

- `content` (delta + full content)
- `thinking`
- `tool_call`
- `tool_result`
- `approval-requested`
- `done`
- `error`

…and each chunk has `type`, `id`, `model`, `timestamp`. ([TanStack][5])

### Mastra streaming event types (source format)

Mastra `.stream()` emits events like `text-delta`, `tool-call`, `tool-result`, `finish`, etc. ([Mastra][6])
Mastra also supports “tool approval” where streaming pauses until resumed. ([Mastra][7])

### Mapping strategy (minimum viable)

- `text-delta` → `content`
- `tool-call` → `tool_call`
- `tool-result` → `tool_result`
- `tool-call-approval` → `approval-requested`
- `finish` → `done`
- errors → `error`

---

## 8) Step-by-step implementation plan (for an AI coding agent)

This is the sequence you should instruct your AI builder to follow.

### Step 1 — Electron bootstrapping (secure defaults)

- Create BrowserWindow with:

  - `contextIsolation: true`
  - `nodeIntegration: false`
  - `sandbox: true`
  - `preload: preload/index.js`

Acceptance:

- window opens
- renderer cannot access Node APIs

### Step 2 — Preload bridge (minimal IPC)

Expose:

- `getServerConfig(): Promise<{ baseUrl: string; token: string }>`
- `onFsEvent(cb): unsubscribe`

Do **not** expose `ipcRenderer` raw.

Acceptance:

- renderer can call `window.electron.getServerConfig()`

### Step 3 — Start Hono server in main process (random port + token)

- Generate token at startup
- Start server on port `0` or use a port finder
- Store `{ baseUrl, token }`
- Expose config via `ipcMain.handle('get-server-config', ...)`

Use Hono node server adapter. ([GitHub][2])

Acceptance:

- internal server is reachable only with Authorization header

### Step 4 — Create Hono app + auth middleware

In `createHonoApp({ token })`:

- `app.use('*', authMiddleware(token))`
- (optional) `cors()` allow only your app origin
- add routes:

  - `/system/status`
  - `/api/chat` (SSE)
  - (optional) mount MastraServer routes

Mastra’s official Hono server integration uses `MastraServer` + `await server.init()`. ([Mastra][8])

### Step 5 — Mastra instance: coder agent + tools

Create tools (privileged, validated):

- FS:

  - `readFile`
  - `writeFile`
  - `applyPatch` (preferred: diff-based editing)
  - `listDir`

- Shell:

  - `runCommand` (stream stdout/stderr)

- Git:

  - `gitStatus`, `gitDiff`, `gitCommit`, etc.

Mastra tool streaming supports writing progress via `context.writer` / `writer.custom`. ([Mastra][9])

Acceptance:

- tools can run from main process without UI

### Step 6 — `/api/chat`: protocol-bridge SSE endpoint

Implement:

- `POST /api/chat` receives `{ messages, threadId?, resourceId? }`
- `const stream = await coderAgent.stream(messages, { abortSignal, requireToolApproval: true, memory: ... })` ([Mastra][7])
- Use Hono `streamSSE` to send TanStack chunks as SSE. ([Hono][10])
- Handle abort:

  - use request AbortSignal
  - call cleanup and kill child processes

Acceptance:

- curl can stream JSON chunks
- “Stop” ends the stream quickly

### Step 7 — Renderer: TanStack AI + Solid UI

In renderer:

- load config from preload
- initialize chat:

```ts
useChat({
  connection: fetchServerSentEvents(`${baseUrl}/api/chat`, () => ({
    headers: { Authorization: `Bearer ${token}` },
  })),
});
```

TanStack explicitly documents headers + dynamic options for `fetchServerSentEvents`. ([TanStack][3])

Acceptance:

- messages stream into UI
- stop cancels stream

### Step 8 — Tool approvals (human-in-the-loop)

- When Mastra emits approval-required events, map to TanStack `approval-requested` chunk ([TanStack][5])
- UI shows Approve/Decline
- UI sends approval response to server endpoint
- server resumes the Mastra stream (per Mastra approval docs) ([Mastra][11])

Acceptance:

- tool calls pause, UI approves, execution resumes

### Step 9 — File watchers via IPC

- main: `chokidar.watch(workspaceRoot)`
- on event: `webContents.send("fs:event", evt)`
- renderer: subscribe via preload `onFsEvent`

Acceptance:

- editing files updates UI in real-time

---

## 9) IPC best practices (so it stays clean)

1. **One module for IPC** (per side), no scattered channels
2. Prefer `invoke/handle` for request/response
3. Prefer push events only for “external changes” (watchers, system state)
4. Keep IPC payloads JSON-only (structured clone-safe) ([Electron][1])
5. Validate everything at the boundary (Zod is ideal)

---

## 10) Coding-agent-specific tool design (avoid regret)

### Make tools deterministic + structured

Return JSON objects, not only raw strings:

- `{ exitCode, stdout, stderr, durationMs }`
- `{ changedFiles, diff }`

### “Plan then apply” for file edits

- agent proposes diff
- UI previews
- user approves
- applyPatch executes

### Workspace sandboxing (critical)

- canonicalize paths
- deny `../` traversal
- disallow writing outside workspace root

### Stream tool progress

- long tools should emit incremental events (download %, test progress, etc.)
- Mastra supports streaming tool progress via `context.writer` ([Mastra][9])

---

## 11) Definition of Done checklist (what your AI builder must satisfy)

- [ ] Electron window runs with contextIsolation + no nodeIntegration
- [ ] Main process starts loopback-only Hono server on random port
- [ ] Renderer gets `{ baseUrl, token }` via preload IPC
- [ ] `/api/chat` streams **TanStack AI StreamChunks** over SSE
- [ ] `useChat + fetchServerSentEvents` works with auth headers
- [ ] Stop cancels stream + terminates tool processes
- [ ] Tools exist (fs + shell + git), validated and sandboxed
- [ ] File watcher events push to UI via IPC
- [ ] Tool approval is implemented (pause/resume)

---

If you want, I can also provide a **full skeleton implementation** (actual file contents for each module) that follows this plan exactly—main process server, Mastra agent, SSE bridge, preload IPC, and SolidJS UI wiring—so you can paste it into a repo and iterate.

[1]: https://www.electronjs.org/docs/latest/tutorial/ipc "Inter-Process Communication | Electron"
[2]: https://github.com/honojs/node-server "GitHub - honojs/node-server: Node.js Server for Hono"
[3]: https://tanstack.com/ai/latest/docs/guides/connection-adapters "Connection Adapters | TanStack AI Docs"
[4]: https://www.blackhat.com/docs/us-17/thursday/us-17-Carettoni-Electronegativity-A-Study-Of-Electron-Security-wp.pdf?utm_source=chatgpt.com "Electron Security Checklist"
[5]: https://tanstack.com/ai/latest/docs/protocol/chunk-definitions "Chunk Definitions | TanStack AI Docs"
[6]: https://mastra.ai/docs/streaming/events "Streaming Events | Streaming | Mastra Docs"
[7]: https://mastra.ai/reference/streaming/agents/stream "Reference: Agent.stream() | Streaming | Mastra Docs"
[8]: https://mastra.ai/reference/v1/server/hono-adapter "Reference: Hono Adapter | Server | Mastra Docs"
[9]: https://mastra.ai/docs/streaming/tool-streaming "Tool streaming | Streaming | Mastra Docs"
[10]: https://hono.dev/docs/helpers/streaming "Streaming Helper - Hono"
[11]: https://mastra.ai/docs/agents/agent-approval?utm_source=chatgpt.com "Agent Approval | Agents | Mastra Docs"
