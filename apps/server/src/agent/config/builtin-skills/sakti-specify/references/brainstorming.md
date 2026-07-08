# Brainstorming Guide (Specify Phase — full workflow)

Turn the plan-phase proposal into a detailed specification through collaborative dialogue. Produces `design.md` + `tasks.md` (and spec deltas when the change modifies behavior).

**IMPORTANT: This phase is for thinking, not implementing.** You may read files, search code, and investigate the codebase, but you must NEVER write code or implement features. If the user asks you to implement something, remind them that the specify phase is about thinking first. You MAY capture insights as notes for the design — that's capturing thinking, not implementing.

<HARD-GATE>
Do NOT create design.md, tasks.md, write spec deltas, or take any implementation action until you have presented a design proposal and the user has approved it. This applies to EVERY change regardless of perceived simplicity.
</HARD-GATE>

## Anti-Pattern: "This Is Too Simple To Need A Design"

Every change goes through this process. A single function, a config change, a one-liner fix — all of them. "Simple" changes are where unexamined assumptions cause the most wasted work. The design can be short (a few sentences for truly simple changes), but you MUST present it and get approval.

---

## The Process

### 1. Orient on the Proposal

You are NOT starting from scratch. The plan phase produced:

- **proposal.md** — the problem, what changes, scope, impact (the "why" and rough "what")

Read it before asking any questions. Your job is to go **deeper**: implementation approach, technical risks, testing strategy, task breakdown, and — if the change modifies behavior — the spec deltas (requirements + acceptance scenarios per capability).

If the proposal is unclear or missing scope, flag it — that's a signal to return to the plan phase, not to fill gaps during specify.

### 2. Ask Clarifying Questions

Ask questions one at a time. Focus on what the phase-1 artifacts don't cover:

- **Implementation approach:** Which patterns, libraries, or architectures fit the existing codebase?
- **Technical risks:** What could go wrong? What's unknown? What needs a spike?
- **Testing strategy:** Unit? Integration? E2E? What are the key test scenarios?
- **Task sequencing:** What depends on what? What should be built first?
- **Spec gaps:** Are there missing acceptance scenarios or ambiguous requirements?

Prefer multiple choice when possible, but open-ended is fine when the question is genuinely exploratory.

Only one question per message. If a topic needs more exploration, break it into multiple questions.

### 3. Explore the Codebase

Ground every answer in the actual code. Don't theorize — read the files:

- Map existing architecture relevant to the change
- Find integration points and patterns already in use
- Identify hidden complexity and dependencies
- Surface risks that aren't visible from the artifacts alone

When you find something relevant, share it — "I see the existing pattern in `file:line` is X, should we follow that or do Y?"

### 4. Propose 2-3 Approaches

Once you understand the problem, propose 2-3 technical approaches with trade-offs:

- Lead with your recommended approach and explain why
- Present alternatives with their trade-offs
- Be concrete: reference actual files, modules, and patterns from the codebase

Present options conversationally. Don't dump a giant comparison table unless the comparison is genuinely complex.

### 5. Present the Design Proposal

Once an approach is chosen, present the full design proposal:

- **Technical approach:** architecture, data flow, key decisions and rationale
- **Alternatives considered:** what was rejected and why
- **Risks & mitigations:** table of risks, impact, and mitigation strategies
- **Testing strategy:** unit/integration/e2e approach, key test scenarios
- **Task breakdown plan:** how tasks.md will be structured (sequencing, per-task details)
- **Spec deltas:** requirements + acceptance scenarios to write (or "None — no behavior change")

Scale each section to its complexity — a few sentences for straightforward areas, more detail for nuanced ones.

Present this proposal in the conversation. Do NOT write any files yet. The user must confirm before you create artifacts.

---

## Design for Isolation and Clarity

- Break the system into smaller units that each have one clear purpose, communicate through well-defined interfaces, and can be understood and tested independently
- For each unit, answer: what does it do, how do you use it, and what does it depend on?
- Can someone understand a unit without reading its internals? Can you change the internals without breaking consumers? If not, the boundaries need work
- Smaller, well-bounded units are easier to reason about and edit reliably. When a file grows large, that's often a signal it's doing too much

## Working in Existing Codebases

- Explore the current structure before proposing changes. Follow existing patterns
- Where existing code has problems that affect the work (large files, unclear boundaries, tangled responsibilities), include targeted improvements as part of the design
- Don't propose unrelated refactoring. Stay focused on what serves the current change

---

## Key Principles

- **One question at a time** — Don't overwhelm with multiple questions
- **Multiple choice preferred** — Easier to answer than open-ended when possible
- **YAGNI ruthlessly** — Remove unnecessary complexity from all designs
- **Explore alternatives** — Always propose 2-3 approaches before settling
- **Incremental validation** — Present design, get approval before creating artifacts
- **Be flexible** — Go back and clarify when something doesn't make sense
- **Ground in reality** — Read the actual codebase, don't theorize
- **Don't rewrite the proposal** — Your job is to go deeper (design, tasks, spec deltas), not to redo planning

---

## Red Flags

These thoughts mean STOP — you're rationalizing:

| Thought                                                | Reality                                                                            |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| "The proposal already covers this"                     | The proposal is the rough plan. Go deeper: implementation, risks, testing          |
| "This is simple enough to skip the proposal"           | Every change gets a proposal. Simple changes need it most — assumptions hide there |
| "I can just write the design.md directly"              | HARD-GATE: no artifacts before user confirms the proposal                          |
| "The user would probably agree with this approach"     | Cannot decide for the user — present and wait                                      |
| "I'll just quickly check the code while brainstorming" | Reading is fine. Writing code is not. Specify is thinking time                     |
| "The specs have a gap, let me fix it now"              | Flag it as a spec delta candidate. Don't write it until after confirmation         |
