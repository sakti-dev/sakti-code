# ROADMAP

Ordered by most applicable tasks. Each task includes a reference to the exact plan lines to read first.

**Status Legend:** ✅ Complete | 🟡 Partial | ⏳ Pending

1) ✅ Implement storage + session bridge (Drizzle/libsql setup, **app path resolver + absolute DB URLs**, schemas, UUIDv7 session flow, Mastra Memory wiring, repo cache in cache).
   Ref: `01-storage-session-bridge.md:L17-L146`

2) ✅ Build core Instance context system (AsyncLocalStorage context, Instance.provide, bootstrap, state, workspace detection).
   Ref: `new-architecture-plan.md:L185-L560`

3) ✅ Update core tools to respect Instance.directory (filesystem + shell + registry).
   Ref: `new-architecture-plan.md:L1389-L1715`

4) ✅ Add server middleware + core routes (directory context, auth, error handling, chat + health + workspace endpoints, server wiring).
   Ref: `new-architecture-plan.md:L730-L1203`
   **Note:** Implementation uses `/api/chat` instead of `/api/prompt`, and `/api/permissions/rules` instead of `/api/rules`.

5) ✅ Implement XState loop control + hierarchical machine design.
   Ref: `new-integration.md:L167-L520`

6) ✅ Implement XState actors + dynamic tool routing per phase.
   Ref: `new-integration.md:L739-L1145`

7) ✅ Add doom-loop detection guards.
   Ref: `new-integration.md:L1328-L1384`

8) ✅ Wire Plan/Build agents to HybridAgent (multimodal routing, directory-aware tools).
   Ref: `new-architecture-plan.md:L1770-L1793`

9) ✅ Implement Sequential Thinking tool and integrate into agent loops.
   Ref: `new-sequential-thinking.md:L91-L180`, `new-sequential-thinking.md:L489-L540`
   **Note:** Implemented with 21 passing tests, session-based state management, and tool registry integration.

10) ✅  Implement search_docs / better-context tool stack (core infra → AST → supporting tools → sub-agent → main tool).
    Ref: `new-better-context.md:L1230-L1272`

11) ✅ Implement Electron main + preload bridge (sidecar spawn/integration + IPC APIs).
    Ref: `new-architecture-plan.md:L1996-L2263`
    **Note:** Implemented with comprehensive IPC handlers (server, dialogs, shell, app, permissions, fsWatcher stubs), 18 passing tests, full TypeScript definitions, and organized preload API.

12) ⏳ Build Solid UIMessage chat UI (types → store → stream parser → hook → components).
    Ref: `new-solid-ai-integration.md:L406-L1131`

---

## Implementation Notes

### Route Deviations from Plan

The implementation deviates from the original plan in the following ways:

| Plan Route | Implementation | Reason |
|------------|----------------|--------|
| `POST /api/prompt` | `POST /api/chat` | More semantic naming for chat interface |
| `GET /api/rules` | `GET /api/permissions/rules` | Better namespacing - rules grouped under permissions |
| `POST /api/permissions` | `POST /api/permissions/approve` | More specific endpoint name |
| `GET /api/workspace` | ✅ Implemented | Added as missing endpoint |

### Current Endpoint Inventory

```
✅ GET  /health (aliased as /api/health)
✅ GET  /api/workspace
✅ POST /api/chat
✅ GET  /api/chat/session
✅ GET  /api/events
✅ GET  /api/events/permissions
✅ POST /api/permissions/approve
✅ GET  /api/permissions/pending
✅ POST /api/permissions/session/:sessionID/clear
✅ GET  /api/permissions/rules
✅ GET  /api/permissions/rules/config
✅ GET  /api/permissions/rules/default
✅ PUT  /api/permissions/rules
✅ POST /api/permissions/rules
✅ POST /api/permissions/rules/config
✅ POST /api/permissions/rules/reset
✅ DELETE /api/permissions/rules
✅ POST /api/permissions/rules/evaluate
✅ GET  /api/config
```

### Phase Completion Status

| Phase | Task | Status |
|-------|------|--------|
| 1 | Storage + Session Bridge | ✅ Complete |
| 2 | Core Instance Context | ✅ Complete |
| 3 | Tools respect Instance.directory | ✅ Complete |
| 4 | Server middleware + routes | ✅ Complete |
| 5 | XState loop control | ✅ Complete |
| 6 | XState actors | ✅ Complete |
| 7 | Doom-loop detection | ✅ Complete |
| 8 | Plan/Build → HybridAgent | ✅ Complete |
| 9 | Sequential Thinking | ✅ Complete |
| 10 | search_docs / better-context | ✅  Complete |
| 11 | Electron main + preload | ✅ Complete |
| 12 | Solid UIMessage UI | ⏳ Pending |
