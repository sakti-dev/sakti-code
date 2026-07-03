# SDD Task Lifecycle — Design

**Vision.** Make sakti-code a coding agent with a built-in spec-driven development
(SDD) workflow. Work moves through a defined lifecycle —
`intake → plan → build → review → merged` — gated by user approvals via a single
generic `ask` tool. The sidebar becomes the viewer for this lifecycle.

## In scope / Deferred

**In scope**

- Task status model (`planning → building → review → merged`)
- Generic `ask` tool replacing `propose_session`
- Agent prompt rewrites + status-based agent resolution
- Forced compaction/observe on the plan→build switch
- Sidebar redesign around the active project's tasks

**Deferred (explicitly)**

- Worktree-per-task — tasks share `project.cwd` for now
- Inline suspended `ask` response — `ask` always terminates the turn in v1
  (reply arrives as next user message)
- Verify sub-agent during `review` — review is a user gate in v1
- Re-open (`merged → active`) task action
- Open-ended `ask` UI — mechanism supported, no policy wired beyond the three
  gate kinds

## 1. Task model & status

- **"task"** is the UI word; the `sessions` table and `kind: 'task'` column are
  unchanged internally.
- **New `status` column** on `sessions`: `text`, default `'planning'`. Values:
  `planning | building | review | merged`.
- `SessionMeta` (desktop) gains `status`.
- Tasks are born in `planning` when created from an approved `ask(kind=session)`.
- **Migration:** existing task rows (no status) default to `building` (assume
  in-progress).

## 2. Status lifecycle & transitions

```
intake ──ask(session)──▶ planning ──ask(plan)✓──▶ building ──ask(completion)──▶ review ──Merge──▶ merged
                              │                      │                           │
                              └ Revise (stay)        └ (work)                   └ Request changes ─▶ building
```

| Transition          | Trigger                      | Who                                 |
| ------------------- | ---------------------------- | ----------------------------------- |
| intake → planning   | `ask(kind=session)` approved | user (Create)                       |
| planning → building | `ask(kind=plan)` approved    | user (Approve) — **forced compact** |
| building → review   | `ask(kind=completion)`       | agent (auto-enters review)          |
| review → merged     | Merge button                 | user                                |
| review → building   | Request changes              | user                                |

## 3. Generic `ask` tool (`packages/tools/src/ask/`)

Replaces and deletes `propose_session`.

- **Signature:** `ask({ kind?: string, body: string })`. No `kind` enum in the
  schema.
- **`execute()`** returns text + `terminate: true`. Always ends the turn in v1.
- **Kinds live in each agent's system prompt** (policy), not the tool.
- **Dual mode, decided by the server:**
  - `kind` is wired (`session`/`plan`/`completion`) → **confirm** card with
    fixed buttons → wired transition.
  - `kind` absent/unknown → **open question** card with text input → reply
    lands as next user message.

**Layering:**

```
packages/tools    mechanism only — knows nothing about kinds/cards
agent prompts     policy — when to ask, which kind
apps/server       wiring — kind → { transitions, card }
```

## 4. Server wiring (`apps/server`)

A `kind → { onApprove, onReject, card }` table:

| kind         | onApprove                                                    | onReject          | card                  |
| ------------ | ------------------------------------------------------------ | ----------------- | --------------------- |
| `session`    | create task session (status=`planning`)                      | —                 | `proposed-session`    |
| `plan`       | status=`building` + **force compact/observe** + switch agent | stay `planning`   | `proposed-plan`       |
| `completion` | status=`merged`                                              | status=`building` | `proposed-completion` |

- One generic route: `POST /sessions/:id/confirm { action: "approve" | "reject" }`
  → dispatches via the table.
- The `ask` tool-call event flows through the WS; the server flips status /
  registers the pending card per the kind.

## 5. Agent prompts + resolver (`apps/server/src/agent/config`)

Each primary agent owns exactly one `ask` kind:

| Session | Status     | Agent    | `ask` kind   | Prompt teaches                                    |
| ------- | ---------- | -------- | ------------ | ------------------------------------------------- |
| intake  | —          | `intake` | `session`    | product/rough planning only; no impl detail       |
| task    | `planning` | `plan`   | `plan`       | research → detailed implementation plan; no edits |
| task    | `building` | `build`  | `completion` | execute approved plan; verify; summarize on done  |

- **`prompts.ts` rewritten** — SDD-aware (current ones are one-liners).
- **`activeToolNames`:** add `ask` to intake/plan/build; remove `propose_session`
  from intake.
- **Resolver (`resolveSessionAgentForKind`)** extended to read status for task
  sessions: `planning` → `plan`, `building` → `build`. Reuses the existing `plan`
  ruleset that _structurally_ denies edits during planning — not just by
  instruction.
- `explore` / `general` subagents unchanged.

## 6. Forced compaction on plan→build switch

The only in-session agent switch is `planning → building`. On
`ask(kind=plan)` approve, **before** resolving the build agent:

1. `setStatus("building")`
2. **Force context reset**, branched on mode:
   - non-OM → force compaction
   - OM on → force observation
3. **The approved plan body is preserved** — re-injected as the pinned lead
   artifact; the planning _chatter_ (research, drafts, Q&A) is what gets
   compacted.
4. Build agent runs next turn on `[approved plan] + [compacted research]`.

**Rationale:** the agent switch invalidates the prompt cache anyway (system
prompt + tools/ruleset change), so compacting costs nothing cached and gives the
build agent a clean, plan-focused start.

## 7. Sidebar redesign (`apps/desktop`)

Projects live in the **top bar** (project tabs). The sidebar is purely a task
navigator for the active project.

```
┌──────────────────────────────────────────┐
│ TASKS                                ＋   │  ← New task → intake home
├──────────────────────────────────────────┤
│ ┃  Refactor sidebar                 2m   │ ┐ active task
│ ┃  ●  [building]                         │ ┘ (left bar both lines)
│                                          │
│    Add OAuth login                  1h   │
│    ●  [review]                           │
│                                          │
│    Fix compaction test              3h   │
│    ●  [planning]                         │
│                                          │
│──────────────────────────────────────────│  ← border-t
│  ▾  🗄  Archived                     1   │  ← accordion (collapsed default)
│     Tool registry                   2d   │
│     ○  [merged]                          │
│                                          │
├──────────────────────────────────────────┤
│ v0.1.0                                   │
└──────────────────────────────────────────┘
```

- **Header:** `TASKS` + `＋` (→ intake home via `upsertIntakeSession`).
- **Flat list:** `sessions WHERE projectId = active AND kind = 'task'`, sorted
  `updatedAt desc`.
- **Two buckets derived from status** (no new column):
  - **Active** (`planning`/`building`/`review`) — direct list.
  - **Archived** (`merged`) — accordion: `border-t`, header = chevron +
    `FiArchive` + "Archived" + count, collapsed by default. Reuses the
    `MemorySidebarCard` accordion pattern.
- **Task row (2 lines):**
  - Line 1: title + relative time
  - Line 2: activity dot + status pill
- **Activity dot** — derived from per-session `streaming.phase`
  (`idle`/`working`/`error`). **Not stored.**
- **Status pill colors:** `planning` muted, `building` blue, `review` amber,
  `merged` green.
- **Active task** — `border-l-primary` left bar on both lines (like the current
  `session-item` active style).
- **Kebab (`FiMoreVertical`)** — always visible (dim at rest, brighten on hover)
  → dropdown with **Rename + Delete** (v1). Re-open deferred. Same
  hover-brighten idea as the project-tab close button, but rendered always.
- **Memory card removed** from the sidebar. (Its new home — chat area / dedicated
  panel — is a separate design; OM is session-scoped so it belongs near the
  active session anyway.)

**Deleted from current `sidebar.tsx`:** the `<ProjectGroup>` tree,
`expandedProjects` signal, `<ProjectContextMenu>`, `AddProjectInput`, and the
active-project auto-expand effect. Projects management moves out entirely (top
bar owns it).

## 8. Risks / open questions

- **Migration of existing task rows** (no `status`) → default `building`. Verify
  no upstream code assumes the column is absent.
- **`review`/`merged` agent resolution** — no active agent in those statuses.
  Chat shows a read-only transcript + the pending merge/decided state. Confirm
  what the resolver returns (build agent as inert fallback, or an explicit
  "none").
- **`ask` payload persistence** — on reload of a session in `review`, should the
  card re-render with its `body`? v1 lean: derive card presence from
  `status === 'review'`; the `body` lives in the transcript. Storing the payload
  is a follow-up if reload fidelity matters.
- **Status flip mechanism** — confirm whether the WS handler flips status on the
  `ask` tool-call event, or whether status is derived from a persisted pending
  flag. Lean: server flips status on the event (authoritative), desktop mirrors.

---

## Next step

Invoke the **writing-plans** skill to turn this design into a task-by-task
implementation plan, saved to `docs/plans/2026-07-04-sdd-task-lifecycle.md`.
