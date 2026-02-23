# Phase 0 Architecture Contracts

This document defines the canonical authority, reconciliation, and event ownership contracts for the OpenCode Chat Parity implementation.

## 1. Canonical Authority Contract

### 1.1 Single Source of Truth

**SSE events are the canonical source of truth** for all persisted entities (messages, parts, sessions). Optimistic writes are temporary UI artifacts that must reconcile when canonical events arrive.

### 1.2 Optimistic Write Metadata

All optimistic writes must include metadata:

```typescript
interface OptimisticMetadata {
  optimistic: true;
  optimisticSource: "useChat" | "userAction";
  correlationKey: string; // For matching with canonical events
  timestamp: number; // For age-based cleanup
}
```

### 1.3 Authority Hierarchy

1. **SSE Events** (highest authority)
   - Always override optimistic data
   - Contain server-assigned canonical IDs
   - Trigger reconciliation

2. **Optimistic Writes** (temporary)
   - Client-generated IDs
   - Marked with `metadata.optimistic = true`
   - Replaced by canonical events

3. **Local Cache** (lowest authority)
   - Only used during offline scenarios
   - Reconciled on reconnect

## 2. Reconciliation Rules

### 2.1 Message Reconciliation

**Match Priority (first match wins):**

1. Exact ID match (`message.id === canonical.id`)
2. Parent ID + Creation Window + Role match
   - Within 30 seconds of optimistic creation
   - Same parent message (for assistant messages)
   - Same role

**Reconciliation Actions:**

- **Replace**: Optimistic message exists, canonical arrives with same ID → Replace optimistic with canonical
- **Merge**: Optimistic has content, canonical has different ID but matches correlation → Merge content, replace ID
- **Drop**: Optimistic exists but no canonical match after timeout → Drop optimistic

### 2.2 Part Reconciliation

**Match Priority:**

1. Exact part ID match
2. Tool parts: `messageID + type + callID`
3. Text parts: `messageID + type` (for single active text part per message)
4. Reasoning parts: `messageID + type + reasoningId`

**Reconciliation Actions:**

- **Replace**: Same ID → Replace all fields
- **Merge**: Same correlation key, different ID → Merge fields, canonical ID wins
- **Drop**: Orphan optimistic parts without canonical match after stream completion

### 2.3 Cleanup Policy

**Trigger:** Stream completion (`onComplete` or `onError`)

**Actions:**

1. Find all optimistic messages/parts without canonical matches
2. Remove orphans after 5-second grace period
3. Preserve all canonical entities
4. Log cleanup actions for debugging

## 3. Part Type Contracts

### 3.1 Required Fields Matrix

| Part Type    | Required Fields                                               | Optional Fields                      |
| ------------ | ------------------------------------------------------------- | ------------------------------------ |
| `text`       | `id`, `type`, `messageID`, `text`                             | `sessionID`, `time`                  |
| `reasoning`  | `id`, `type`, `messageID`, `text`                             | `sessionID`, `time`, `metadata`      |
| `tool`       | `id`, `type`, `messageID`, `tool`, `callID`, `state`          | `sessionID`, `result`, `error`       |
| `permission` | `id`, `type`, `messageID`, `permissionId`, `toolName`, `args` | `sessionID`, `description`, `status` |
| `question`   | `id`, `type`, `messageID`, `questionId`, `question`           | `sessionID`, `options`, `status`     |

### 3.2 Type Guards

All part types must have validation functions:

```typescript
function isValidTextPart(part: unknown): part is TextPart;
function isValidToolPart(part: unknown): part is ToolPart;
function isValidReasoningPart(part: unknown): part is ReasoningPart;
function isValidPermissionPart(part: unknown): part is PermissionPart;
function isValidQuestionPart(part: unknown): part is QuestionPart;
```

## 4. Permission/Question State Contract

### 4.1 Unified State Path

**Current (to be migrated):**

- `usePermissions` opens separate EventSource
- Maintains separate pending state

**Target:**

- Permission/question events route through main SSE stream
- Events are processed by `event-router-adapter`
- Stored in dedicated permission/question stores
- UI consumes via store selectors

### 4.2 Permission Store Contract

```typescript
interface PermissionRequest {
  id: string;
  sessionID: string;
  messageID: string;
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
  status: "pending" | "approved" | "denied";
  timestamp: number;
}

interface PermissionActions {
  add(request: PermissionRequest): void;
  approve(id: string): void;
  deny(id: string): void;
  resolve(id: string, approved: boolean): void;
  getBySession(sessionID: string): PermissionRequest[];
  getPending(): PermissionRequest[];
}
```

### 4.3 Question Store Contract

```typescript
interface QuestionRequest {
  id: string;
  sessionID: string;
  messageID: string;
  question: string;
  options?: string[];
  status: "pending" | "answered";
  answer?: string;
  timestamp: number;
}

interface QuestionActions {
  add(request: QuestionRequest): void;
  answer(id: string, answer: string): void;
  getBySession(sessionID: string): QuestionRequest[];
  getPending(): QuestionRequest[];
}
```

## 5. Event Ownership

### 5.1 Event Router Responsibilities

- **Deduplication**: Drop events with duplicate `eventId`
- **Ordering**: Buffer out-of-order events, release in sequence
- **Routing**: Dispatch to appropriate store based on event type
- **Reconciliation**: Handle optimistic vs canonical convergence

### 5.2 Store Responsibilities

- **Session Store**: Owns session lifecycle, status
- **Message Store**: Owns message CRUD, FK validation
- **Part Store**: Owns part CRUD, FK validation
- **Permission Store**: Owns permission state
- **Question Store**: Owns question state

### 5.3 Hook Responsibilities

- **useChat**: Manages optimistic writes, stream lifecycle
- **useMessages**: Projects messages from store
- **usePermissions**: Reads from permission store, triggers actions
- **useQuestions**: Reads from question store, triggers actions

## 6. Implementation Checklist

### Phase 0 Exit Criteria

- [ ] All reconciliation tests pass
- [ ] All correlation matching tests pass
- [ ] All part type guard tests pass
- [ ] All permission store tests pass
- [ ] All question store tests pass
- [ ] Architecture note document complete
- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Test coverage > 80% for new code

### Next Phase Ready Criteria

- [ ] Reconciliation layer operational
- [ ] Permission/question stores integrated
- [ ] useChat updated with optimistic metadata
- [ ] Event router handles all new event types
- [ ] No separate permission SSE connection

## 7. Deviation Log

_Record any intentional deviations from OpenCode patterns here:_

| Date | Deviation | Rationale |
| ---- | --------- | --------- |
|      |           |           |

## 8. Markdown Renderer Migration Notes

Desktop markdown rendering has migrated to Incremark stream mode. Canonical architecture notes:

- `apps/desktop/docs/architecture/markdown-rendering-incremark.md`

Migration guardrails:

- Stream renderer only in chat markdown surfaces (no marked fallback path).
- `incremarkOptions.htmlTree = false` by default.
- Do not reintroduce `marked`, `marked-shiki`, `dompurify`, `morphdom` runtime paths.

Verification commands:

```bash
pnpm --filter @sakti-code/desktop test:ui
pnpm --filter @sakti-code/desktop typecheck
pnpm --filter @sakti-code/desktop lint
pnpm --filter @sakti-code/desktop markdown:migration:health
```

---

**Document Version:** 1.0
**Last Updated:** 2026-02-12
**Status:** Phase 0 Implementation
