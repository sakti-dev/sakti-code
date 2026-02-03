# Desktop-Agent Integration Documentation

## Overview

This documentation summarizes the complete integration of the Solid.js desktop UI with the Hono REST API server for full chat functionality with session management and permission handling.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Desktop App (Solid.js + Electron)                   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      WorkspaceProvider                           │  │
│  │  - API Client      - Session Management    - Permissions        │  │
│  │  - useChat hook    - useSession hook       - usePermissions     │  │
│  └───────────────────────────────┬─────────────────────────────────┘  │
│                                  │                                     │
│  ┌──────────┐    ┌──────────┐   ▼    ┌──────────────┐                │
│  │LeftSide  │    │ChatPanel │◀──────│ContextPanel  │                │
│  │Sessions  │    │Messages  │        │Files/Terminal│                │
│  └──────────┘    └──────────┘        └──────────────┘                │
23: └────────────────────────────────┬────────────────────────────────────┘
24:                                  │  HTTP/SSE
25: ┌────────────────────────────────▼────────────────────────────────────┐
26: │                       Hono REST API Server                          │
27: │                                                                      │
28: │  /api/chat     - POST: Stream chat (UIMessage protocol)            │
29: │  /api/sessions - GET: List sessions | DELETE: Remove session       │
30: │  /api/events   - SSE: Permission events, state updates             │
31: └──────────────────────────────────────────────────────────────────────┘
```

## Features Implemented

### 1. Chat System

- **Streaming Response**: Real-time message streaming using `fetch` and custom stream parsing.
- **UIMessage Protocol**: Full support for Vercel AI SDK's UIMessage format (text, tool calls, tool results).
- **Optimistic Updates**: Immediate UI feedback using Solid.js reactive store (O(1) updates).
- **Type Safety**: Strictly typed interfaces for all message parts.

### 2. Session Management

- **Persistence**: Sessions persist across app restarts using `localStorage`.
- **Server Sync**: Automatic synchronization with server-side DB via `/api/sessions`.
- **Continuity**: Seamlessly pick up conversations where you left off.
- **Conflict Handling**: Handles session switching and new session creation properly.

### 3. Permission System

- **Real-time Requests**: Uses SSE (`/api/events`) to receive permission requests from the agent.
- **UI Dialog**: Custom `PermissionDialog` component for user approval/denial.
- **Granular Control**: Users see exactly what tool and arguments are being requested.
- **Reconnection**: Automatic reconnection logic for robustness.

### 4. Database Migrations

- **Drizzle Kit**: Uses standard Drizzle migration workflow.
- **Bundling**: Migration files are bundled with the Electron app for production.
- **Runtime Execution**: Migrations run automatically on app startup.
- **Idempotency**: Safe to run multiple times (uses `IF NOT EXISTS`).

## Code Structure

### Desktop Client (`apps/desktop`)

| Path                                   | Purpose                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `src/providers/workspace-provider.tsx` | Central state management (Chat, Sessions, Permissions) |
| `src/hooks/use-chat.ts`                | Chat logic, streaming, store integration               |
| `src/hooks/use-session.ts`             | Session persistence and syncing                        |
| `src/hooks/use-permissions.ts`         | SSE connection and permission handling                 |
| `src/lib/api-client.ts`                | Typed API client for Hono server                       |
| `src/lib/chat/store.ts`                | Solid.js store for efficient chat updates              |
| `src/lib/chat/stream-parser.ts`        | Parser for server streamed responses                   |
| `src/views/workspace-view/`            | UI Components (ChatPanel, MessageList, etc.)           |

### Server (`packages/server`)

| Path                     | Purpose                              |
| ------------------------ | ------------------------------------ |
| `src/routes/chat.ts`     | Chat endpoint with streaming support |
| `src/routes/sessions.ts` | Session management endpoints         |
| `src/routes/events.ts`   | SSE endpoint for real-time events    |
| `db/schema.ts`           | Drizzle ORM schema definitions       |
| `db/migrate.ts`          | Runtime migration runner             |
| `drizzle/`               | Generated SQL migration files        |

## Data Flow

### Chat Flow

1. User types message → `ChatPanel`
2. `useChat.sendMessage()` called
3. `ApiClient.chat()` sends POST request
4. Server streams response chunks (TextDelta, ToolCall, etc.)
5. `StreamParser` decodes chunks
6. `ChatStore` updates state efficiently
7. UI updates reactively

### Permission Flow

1. Agent needs to run tool → Server emits `permission:request` via SSE
2. `usePermissions` hook receives event
3. `WorkspaceProvider` updates state
4. `PermissionDialog` appears in UI
5. User clicks Approve/Deny
6. `ApiClient.approvePermission()` sends decision to server
7. Agent execution resumes or halts

## Verify & Test

- **Typecheck**: `pnpm typecheck` (Ensures full type safety across repo)
- **Lint**: `pnpm lint` (Code style and best practices)
- **Build**: `pnpm build` (Verifies production build integrity)
- **Dev**: `pnpm dev` (Runs app in development mode)

## Future Improvements

- [ ] **RLM State**: Visualize agent planning steps (thinking process).
- [ ] **Session Titles**: Auto-generate titles from conversation context.
- [ ] **File Drag & Drop**: Support file uploads in chat.
- [ ] **Code Block Actions**: "Apply" or "Copy" buttons for code snippets.
