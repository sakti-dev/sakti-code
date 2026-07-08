# Autonomous Guide (Specify Phase — hotfix workflow)

Drive the complete solution independently — no brainstorming, no "how should we fix this?" questions to the user. Produce `design.md` + `tasks.md` from the proposal, grounded in the actual code. This is the fast path for changes where the path is clear (bug fix, small improvement).

**When to use this mode:** the change was classified `hotfix` — predicted to need NO spec/behavior change. The spec (if any) is correct; the implementation is wrong, or you're making a small improvement.

## The Process

### 1. Orient

Read the inputs:

- **proposal.md** — what's wrong / what to improve and why
- **Existing specs** (`.sakti/specs/`) — the correct behavior the implementation must match (for bug fixes)
- **The actual code** — read the files involved; do not theorize

### 2. Drive the Solution

Work out the complete technical solution yourself:

- Decide the approach (you don't need user input for a fix whose path is clear)
- Identify exact files to touch and how
- Consider risks and testing
- Ground every decision in the real code — read it, cite `file:line`

You may ask the user a question **only** if you hit a genuine ambiguity you cannot resolve from the code and proposal. Otherwise, proceed.

### 3. Produce design.md + tasks.md

Write both artifacts directly (no approval gate — autonomous mode skips brainstorming):

- **design.md** — Context (brief), Technical Approach, Key Decisions (with rationale), Risks & Mitigations, Testing Strategy. Reference the proposal for motivation.
- **tasks.md** — checkbox tasks (`- [ ] N.Y Task`), small enough to complete in one session, ordered by dependency. The build phase parses this format.

### 4. Specs — Usually None. Unless Escalation Triggers.

For a true hotfix (no behavior change), write **no** spec file. The spec is already correct; you're fixing the implementation.

**Escalation trigger:** if, while working, you discover the change actually needs a **behavior change or a new spec** (the classification prediction was wrong):

1. Flip the workflow: `sakti state set <name> workflow full`
2. Switch to brainstorming mode — read `references/brainstorming.md` and follow it
3. Ask the user how they want to design the spec change (you're now in interactive mode)
4. Produce the spec deltas + design.md + tasks.md via the brainstorming flow

Do not silently write a spec delta in autonomous mode — if a spec change is needed, that's a `full` change and the user must weigh in on the design.

## End-of-Specify Gate

Autonomous mode has exactly **one** user gate, at the end: call `transition({ to: "build", body })` where `body` summarizes `design.md` + `tasks.md`. This renders the gate card — the user approves (→ build) or rejects (→ you revise). Do not transition before the artifacts are complete. There is no separate confirm step; the card IS the review.

## Key Principles

- **No brainstorming.** The path is clear; drive it. Questions only for genuine ambiguity.
- **Ground in the real code.** Read files, cite `file:line`. Don't theorize.
- **tasks.md is mandatory.** Always produce it — the build phase (and future per-task subagents) depend on it.
- **Escalate, don't hide, spec changes.** If a behavior change is needed, flip to `full` and brainstorm with the user.
- **One confirm at the end.** Present design.md + tasks.md via `ask` before transitioning.

## Red Flags

| Thought                                               | Reality                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| "I'll ask the user how they want to fix it"           | No — autonomous mode means you drive the solution. Ask only on genuine ambiguity |
| "This needs a small behavior tweak, I'll just add it" | Any behavior/spec change triggers escalation to `full` + brainstorming           |
| "I can skip tasks.md, it's a one-liner"               | tasks.md is mandatory for every change (build phase + future subagents need it)  |
| "I'll transition without the end-of-specify confirm"  | The one blocking point in autonomous mode is the final `ask` confirm             |
