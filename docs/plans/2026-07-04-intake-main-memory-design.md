# Intake Main-Memory + Child Intakes — Design

> **VOCABULARY NOTE (2026-07-04):** The domain word `task` was renamed to
> `mission`. The `sessions.kind` value is `'mission'` (was `'task'`);
> `SessionMeta.kind` is `"intake" | "mission"`. Below, domain references to
> "task"/"Task" mean "mission". Plan-step labels like "Task 1.1" are unchanged
> (they're plan meta-language).

**Vision.** Make Observational Memory (OM) the single context/memory strategy
for sakti-code, and reshape the intake agent around it: one **main intake** per
project that is never chatted with directly — it is the project's durable,
shared memory — plus many short-lived **child intakes** that you actually chat
with, each of which inherits the main's accumulated memory and graduates new
missions back into it. Traditional compaction is removed entirely; OM's
observe→prune loop is the sole context-window manager.

## Motivation

Two realisations drove this:

1. **Compaction is redundant once OM exists.** A trace through the agent core
   confirms it. Each turn `agent-loop → maybeObserve`; when the observation
   threshold trips, messages are observed into the OM record, then
   `pruneObservedMessages` appends an `ObservationPruneEntry` to the session
   tree. The context builder (`session/session.ts:51-65`) honours that entry:
   it collects the cumulative `observedEntryIds` and **skips** those messages
   when building the context sent to the model — their content now lives
   compressed in the system-prompt observations block. OM is already a
   threshold-triggered context-window manager. Compaction is a second,
   inferior one doing the same job.

2. **A single shared intake memory per project is what users actually want.**
   Today the intake is a singleton you chat with directly; forking and reload
   fidelity are awkward, and a fresh intake starts blind. The fix is to make
   the intake's _memory_ the singleton (not its conversation), and let
   conversations be cheap, fork-like child sessions that read that memory
   read-only and graduate new entries into it.

## In scope / Deferred

**In scope**

- Remove the entire compaction subsystem from `packages/agent` and the server
  (auto-compaction, retry-loop phase, runner deps, harness API, entry type,
  endpoint).
- The intake model: main intake = the project's resource-scope OM record (no
  session row); child intakes = chattable `kind=intake` sessions.
- Graduation: on `ask(kind=session)` approval from a child, force-observe +
  force-reflect the child into the project's resource-scope OM, then spawn the
  mission.
- Missions observe their own thread-scope OM **and** read the project
  resource-scope OM read-only (the "inject both" runner change).
- Onboarding/home becomes a grid of child-intake cards instead of a direct
  intake chat.

**Deferred (explicitly)**

- A read-only "project memory" viewer UI (the main intake's OM record is
  invisible in v1).
- Worktree-per-mission — missions still share `project.cwd`.
- Thread-scope OM for intake children (children are read-only in v1; only
  graduation writes the project OM).
- Migration of any existing sessions — the DB will be deleted; no legacy
  compaction entries to honour.

## 1. Drop compaction (enabler)

Compaction is woven through the agent core; removing it is mechanical but
broad. The DB will be deleted, so there is no legacy `compaction` entry to keep
honouring — the entry type and builder branch go too.

**Removed:**

- `packages/agent/src/memory/compaction/` — the whole directory
  (`auto-compaction.ts`, `retry-loop.ts` compaction phase, `compaction.ts`).
- `packages/agent/src/runner/agent-run.ts` — the `compactionSettings` and
  `compactionPrompts` run deps, and the `runCompaction` callback handed to the
  retry loop.
- The agent-loop compaction phase (`runCompactionPhaseEffect`). OM's
  `maybeObserve` (already called every turn) becomes the sole window manager.
- `packages/agent/src/agent/agent-harness.ts` — `compact()`, `compactEffect`.
- `packages/agent/src/session/{entries,session}.ts` — the `compaction` entry
  type, `appendCompaction` on `SessionShape`, and the builder branch
  (`session.ts:46-48`, `83-106`).
- Server: `apps/server/src/routes/sessions/compaction.ts`,
  `apps/server/src/agent/commands/compact.ts`, the `/compact` WS message
  branch in `ws-handler.ts`, and the OM-off/runCompact fallback in
  `apps/server/src/agent/config/force-reset.ts` (collapses to
  always-`forceObserve`).
- Desktop: any compaction UI affordance / command wiring.
- ~60 tests passing `TEST_COMPACTION_PROMPTS` / `compactionSettings` are
  rewritten to drop those deps.

**Net effect:** OM's `maybeObserve → pruneObservedMessages` loop is the only
thing keeping a long mission's context bounded, and it is already wired into
every turn. Nothing new is added to keep context manageable; a redundant path
is deleted.

## 2. Roles & memory model

Three things; not all are sessions.

| Role             | What it is                                                                                                                                    | Chatted with?                             | Own OM?                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| **Main intake**  | The project's **resource-scope OM record** — keyed `(threadId=null, resourceId=projectId)` in `observational_memory`. **Not a sessions row.** | **Never.** Fed only by graduation events. | —                                                              |
| **Child intake** | A session, `kind=intake`. What you actually chat with. Many per project.                                                                      | Yes                                       | No — reads project OM read-only.                               |
| **Mission**      | A session, `kind=mission`. Unchanged kind.                                                                                                    | Yes                                       | Yes — thread-scope own OM **plus** reads project OM read-only. |

**Memory flow.** The main intake's resource-scope OM is the single project-wide
memory. Child intakes and missions **read it read-only** via the existing
`observationalMemoryReadOnly` injection (`runner.ts:582-594`). That path fires
when a session has no own-OM config — which for children is always, and for
missions is the _second_ of the two blocks they receive (see §4).

**No schema change for a main/child discriminator.** The "main intake" is not
a session — it is the OM record. Every `kind=intake` session is a child. The
old singleton upsert (`findIntakeByProject` / `POST /projects/:id/intake-session`)
is replaced by `listChildIntakesByProject` (all `kind=intake` for the project)
and a new create-child route.

## 3. Child intake lifecycle

1. **Create** — plus button / onboarding "new" → `POST /api/projects/:id/intake-sessions`
   creates a new `kind=intake` session.
2. **Chat** — normal intake agent run. The child has no own-OM config, so each
   turn it reads the project's resource-scope OM read-only. This is how "every
   new child knows what I'm talking about."
3. **Graduate** — child calls `ask(kind=session)` with the brief; the user
   approves. Graduation fires (§4), then the mission is spawned via the
   existing `createSession` + `sendPrompt(brief)` flow.

## 4. Graduation (the one genuinely new piece on the intake side)

Trigger: approval of `ask(kind=session)` from a child intake (today
`session.onApprove` in `ask-kinds.ts` is a no-op; we fill it in).

Steps:

1. Spin up a **one-shot `ObservationalMemoryEngine`** pointed at the
   **child's** sessionStorage, with **`scope: "resource"`**. Because of
   `engine.ts:84-86`, the engine keys its output at
   `(threadId=null, resourceId=projectId)` — the main's slot — _while observing
   the child's transcript_.
2. `forceObserve()` → `forceReflect()`. The reflection lands in the main
   intake's resource-scope OM record. Best-effort + logged, mirroring the
   existing `forceReset` pattern: a graduation failure must not strand the
   mission (the status flip / mission spawn is the user's durable intent).
3. Spawn the mission (existing `createSession` + `sendPrompt(brief)`).

Result: the next child created reads the now-richer project OM and knows about
this mission and the discussion that produced it.

## 5. Missions: observe own thread + read project OM (option A)

With compaction gone, the mission plan→build reset (`force-reset.ts`) collapses
to always-`forceObserve` the mission's own thread-scope OM — there is no
compaction fallback. That means missions run their own OM during normal turns.
But missions should _also_ see the project's accumulated intake memory, so the
runner is changed to inject **both** OM blocks for missions:

- own thread-scope OM (the mission's evolving context), **and**
- the project resource-scope OM, read-only.

Today the runner is either/or (`if (observationalMemory) … else if
(observationalMemoryReadOnly) …`). The change: when a session has its own OM,
**also** construct the read-only block from the resource-scope record and pass
both; the agent-loop composes the two system-prompt blocks. (Intake children,
which have no own OM, are unchanged — they already take the read-only branch.)

## 6. Onboarding / home UI

`OnboardingPanel` stops being a direct intake chat. It becomes a **grid of
cards**, one per child intake (`listChildIntakesByProject`), plus a "New intake"
affordance. Clicking a card opens that child's chat — the current
`MessageTimeline` + `ChatInput` + `AskCard` view, bound to the chosen child.
The sidebar continues to show **missions** only; intakes live in the home grid.

## 7. What's reused vs new

**Reused as-is:** resource-scope OM keying (`engine.ts:84-86`); read-only OM
injection (`runner.ts:582-594`); `forceObserve` / `forceReflect`; the
`ask(kind=session)` handoff; `forkFrom` (children don't transcript-fork in v1
— they inherit via the read-only OM path, so forking is unneeded).

**New:** (a) compaction removal (§1, broad but mechanical); (b) graduation
handler in `ask-kinds.ts` `session.onApprove`; (c)
`POST /api/projects/:id/intake-sessions` (create child) + repo
`listChildIntakesByProject`; (d) retire/repurpose the singleton intake upsert;
(e) the inject-both runner change for missions (§5); (f) the onboarding grid
UI.

## 8. Risks & open questions

- **Auto-compaction as a latent safety net is gone.** Previously, if OM were
  misconfigured or its models lacked API keys, auto-compaction would still
  keep a runaway context in check. After this change, a project with OM
  effectively off has _no_ window manager. Mitigation: OM is the mandated
  strategy; profiles/settings must provide observe+reflect models. The
  graduation and plan→build paths already treat an OM failure as best-effort
  (logged, non-fatal).
- **Inject-both cost.** Missions pay for observe+reflect on their own thread
  _and_ carry the project observations block. For long missions this is the
  intended trade (rich shared memory + own context), but it should be watched
  for token cost in practice.
- **Graduation reflection quality.** The child's whole conversation is
  observed+reflected in one shot at graduation. If the reflection is poor, the
  project memory inherits a weak summary. v1 accepts this; a later
  "re-reflect" action could revise.
- **Resource-scope record initialisation.** It is created lazily on the first
  graduation (`forceObserve` initialises it) and read as empty by the first
  children (`getObservationalMemory` → null → empty block). No explicit
  bootstrap needed.
