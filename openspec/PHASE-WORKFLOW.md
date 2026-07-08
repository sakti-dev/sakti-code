# Phase Workflow

> Reference for how the SDD (spec-driven development) phase lifecycle is intended to work. This is the canonical description of the workflow; the builtin skills (`sakti-plan`, `sakti-specify`, `sakti-build`, `sakti-verify`, `sakti-archive`) and the transition system implement it.

## Overview

Work moves through five phases, driven by a single `transition` tool and a server-side transition table that decides gating:

```
plan ──▶ specify ──▶ build ⇄ verify ──▶ archive
```

Two **workflows** scope how a change travels this path:

- **`full`** — the change modifies behavior (new capability, spec change). Specify runs in **brainstorming** mode (interactive with the user).
- **`hotfix`** — no spec change (bug fix where the spec is correct, or a small improvement). Specify runs in **autonomous** mode (no brainstorming).

Both workflows follow the same phase sequence. The `workflow` field only selects the specify *mode* and the build-phase defaults — it does not change the sequence.

## Session kinds

- **Plan sessions** (`kind: plan`) — where a user plans work. Produces `proposal.md`, classifies the change, and **graduates** into a mission.
- **Mission sessions** (`kind: mission`) — where the change is specified, built, verified, and archived. A mission is created by the plan→mission graduation and is linked to its change via `sessions.changeName`.

## Artifacts per phase

| phase | produces | owns |
|---|---|---|
| plan | `proposal.md` (why + what + impact; no Capabilities section) | sakti-plan |
| specify | `design.md` + `tasks.md` (always); `specs/<cap>/spec.md` only when there's a behavior delta | sakti-specify |
| build | the implementation (source changes); checks off `tasks.md` | sakti-build |
| verify | a verification report / fixing plan (written to the change dir); no source edits | sakti-verify |
| archive | syncs delta specs into main specs; moves the change to archive | sakti-archive |

`design.md` is a single doc (there is no separate `technical-design.md`). `tasks.md` is **mandatory for every change** — the build phase (and future per-task subagents) depend on it.

## The transition tool

Agents move between phases by calling:

```
transition({ to: "specify" | "build" | "verify" | "archive" | "mission", body: string })
```

- The agent's **only job is deciding the destination** based on its judgment. It does **not** decide whether the transition is gated.
- `body` carries the handoff payload (mission brief, fixing plan, completion/verify summary).
- The call ends the agent's turn (`terminate: true`). It is a pure signal — the server owns all policy and side-effects.

## The transition table (single source of truth for gating)

A server-side table declares each phase edge as **gate** (renders a yes/no card, pauses the chain) or **auto** (fires side-effects and continues immediately), plus the side-effect and the `<instruction>` delivered to the next phase:

| edge | mode | side-effect |
|---|---|---|
| plan → mission | gate | graduate the child plan transcript into the project's resource-scope OM; spawn the mission (born in `specifying`, `changeName` set) |
| specify → build | gate | — |
| build → verify | auto | forced OM observe (bias reduction — verify starts on a compacted context) |
| verify → build | auto | — (verify already wrote the fixing plan as `body`) |
| verify → archive | gate | — |

Verify's two outcomes fall out of the destination it picks: **clean → `to: archive`** (gate); **issues found → `to: build`** (auto). No special "verify decides" logic — the destination is the decision.

## Interaction modes: interactive vs autonomous

| phases | mode | guardrail | mid-run questions |
|---|---|---|---|
| plan, specify-brainstorming | interactive | does not fire | free-text Q&A allowed |
| build, verify, specify-autonomous (hotfix) | autonomous | fires on stall | none — refinements batched into the verify summary |

**The better default:** once specify is approved (the specify→build gate), the agent **never stops to ask**. Anything that comes up mid-run is batched into the verify summary and surfaced once, at the verify→archive gate ("things adjusted mid-run: … — is this OK?"). The user decides at the gate, not mid-loop.

## Auto-chain engine

The runner handles one user message but **chains across auto-edges**, stopping only at gates:

```
user message
  → build runs, calls transition({to:verify})        [auto]
       → forced observe → verify runs
  → verify finds issues, calls transition({to:build}) [auto]
       → build runs (reads fixing plan, fixes)
  → build calls transition({to:verify})               [auto]
       → forced observe → verify runs
  → verify clean, calls transition({to:archive})      [gate]
       → card renders, chain PAUSES for user
```

A single user message can drive the whole build⇄verify loop until a gate. Gates are the only pause points. (A defensive cap prevents a buggy skill from infinite-looping the chain.)

## Gate UX (yes / no)

When the agent calls `transition` on a gate-edge, the chain pauses and a card renders.

- **YES** → execute the transition (status flip + side-effects) → auto-start the destination agent (chain resumes).
- **NO** → dismiss the card. **No status change, no side-effect, no message to the agent.** The user keeps the floor and types what to refine; the *current* phase's agent re-runs with that feedback.

NO is deliberately not "reject and route backward" — it returns control to the chat so the user can explain disagreement.

## System prompt & `<instruction>` (cache-safe)

The system prompt is **stable**: just `BASE_PROMPT`, identical across every phase and every agent swap. The per-role prompt sections do not exist — agents differ only in **permission ruleset + active tools** (verify is edit-denied), sharing `BASE_PROMPT`.

Because the system prompt never changes within a session, the **prompt cache survives the entire build⇄verify loop** (today, swapping build↔verify agents changes the system prompt and invalidates the cache every iteration).

Phase-specific guidance is delivered via **`<instruction>` blocks** that live in the transcript (appended), never in the system prompt:

- **Between-phase transitions:** the `<instruction>` rides the `transition` tool *result*.
- **Mission start (no preceding transition):** the `<instruction>` is embedded in the **handoff user message** (the mission brief), since the first run has no prior transition call.

Both use the same XML wrapper so the agent reads them identically:

```xml
<instruction>
You are now in build mode. Read the fixing plan from the transition call above; address every issue, then call transition({to:"verify"}) when done and tests pass. Follow the sakti-build skill.
</instruction>
```

(The skill *content* is still force-injected by the runner via `getBuiltinSkillForPhase`. The `<instruction>` is the concise mode marker; the skill carries the detailed workflow — single source of truth.)

## Runtime guardrail (oh-my-pi style `<reminder>`)

In **autonomous phases**, if the agent ends its turn **without a `transition` call**, the runtime injects a phase-aware reminder and re-runs:

```xml
<reminder phase="build">
Build phase isn't complete — 2 of 5 tasks still unchecked. Continue: pick the next unchecked task in tasks.md, write its failing test (RED), implement minimally (GREEN), commit. Only call transition({to:"verify"}) once every task is checked AND the project's full test suite passes.
</reminder>
```

- Fires only in autonomous phases (build, verify, specify-hotfix) — where stopping is always a stall.
- **Build is progress-aware** — the runtime reads `tasks.md` for the session's change via the sakti library helper `getTaskProgressForChange` and injects real counts ("2 of 5 tasks"). Verify is phase-aware (no checkbox artifact to parse).
- Injected as a user-role message, XML-tagged.
- **Capped** — after ~2 stalls without progress, the reminder escalates, then surfaces to the user instead of looping forever.
- Does **not** fire in interactive phases, where pausing for Q&A is legitimate.

## Classification & escalation

Plan classifies the change (`full` vs `hotfix`) as a blocking point after exploration, using one decidable signal: *does this change modify specs/behavior?* yes → `full`, no → `hotfix`. The agent proposes; the user confirms.

Classification is a **prediction that self-corrects**. If autonomous (hotfix) specify discovers the change actually needs a behavior change or new spec, it **escalates**:

1. Flip `workflow` `hotfix` → `full` (`sakti state set <name> workflow full`).
2. Switch to brainstorming mode (read the brainstorming reference).
3. Ask the user how to design the spec change.
4. Produce the spec deltas + design.md + tasks.md via brainstorming.

This keeps records honest: a misclassified hotfix promotes itself rather than producing a shallow result.

## Permissions per phase

Enforced structurally at the tool layer (not via prompt prose):

- **plan** — allow research + doc-writing; ask before destructive bash.
- **specify (build agent)** — allow edits (writes design.md, tasks.md, specs).
- **build (build agent)** — allow edits (implements).
- **verify (verify agent)** — **edit-denied / write-denied**: report only, never fix. This is the structural counterweight to fix-and-rationalize; verify routes issues back to build via `transition({to:"build"})`.
- **archive** — runs git/spec sync.

## State machine (DB `status` ↔ phase)

| phase | session `status` | builtin skill injected |
|---|---|---|
| plan | (plan session kind) | sakti-plan |
| specify | `specifying` | sakti-specify |
| build | `building` | sakti-build |
| verify | `review` | sakti-verify |
| archive | `merged` | sakti-archive |

Transitions advance via the transition tool (which the server maps to status flips). The CLI transitions (`open-complete`, `specify-complete`, `build-complete`, `verify-pass`, `verify-fail`, `archived`) remain as the low-level state-machine primitives the server uses under the hood.

## Reference: the ask tool is gone

There is no `ask` tool. All lifecycle handoffs use `transition`. Open-ended questions to the user are plain free-text conversation (the agent ends its turn with a question; the user replies). A dedicated `question` tool may be introduced later as separate work — until then, free-text covers the interactive phases, and the autonomous phases don't allow mid-run questions anyway.
