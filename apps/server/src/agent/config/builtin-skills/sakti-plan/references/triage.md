# Triage Guide

Plan is a **router, not a debugger**. Its job is to capture what the user wants, classify the change, and check whether a dependency spec already exists — then hand off. Detailed design, debugging, and implementation thinking happen in specify and build, which will redo all of that from scratch regardless of what plan discovers. Any "how to fix" thinking here is wasted work.

> **The authoritative guardrails live in `SKILL.md` → Guardrails.** This doc elaborates the triage flow. If the two ever seem to conflict, SKILL.md wins.

---

## Allowed reads

Plan may read **only**:

- `.sakti/specs/**` — to check whether a relevant spec already exists (the dependency check)
- `sakti list --json` — active-change context (collisions, related work)
- the user's own message

Everything else is off-limits: source under `packages/`, `apps/`, `electron/`, configs, scripts. If a question genuinely needs source to answer, it belongs in specify, not plan. **Do not "just take a quick look" at the code** — that is the exact detour this phase must avoid.

---

## The triage flow

### 1. Capture intent

Restate the problem in 2–3 sentences, in the user's language. Why they want it, what outcome they expect. No solutioning. If the user's request is vague, ask clarifying questions about **what** and **why** — never about how it would be built.

### 2. Classify

One decidable signal: _does this modify a spec or behavior?_

- **yes** → `full` (new capability, behavior change, cross-cutting work)
- **no** → `hotfix` (bug fix where the spec is correct, or a small improvement)

This is a prediction that self-corrects in specify. When unsure, lean `hotfix` only if you are confident no spec changes; otherwise `full`. (Final classification + name confirmation is the SKILL.md Step 2 blocking point — this doc just feeds it.)

### 3. Dependency check (features only)

For `full` changes, scan `.sakti/specs/` for capabilities this change would touch or depend on. Note them — they feed the proposal's impact section and tell specify where the spec deltas will land. For `hotfix`, skip this step.

---

## The clarification summary

Produce four parts (this feeds `proposal.md`):

- **Goals** — the problem and the expected outcome
- **Non-goals** — what is explicitly out of scope
- **Scope boundaries** — included/excluded modules, users, platforms, or data
- **Key unknowns** — unresolved _requirements_ unknowns (what should happen). Never _implementation_ unknowns (how to build it). Risks or dependencies at the requirements level only.

> Note: acceptance scenarios are **not** produced here. Specify writes them per capability as part of the spec deltas — drafting them in plan would duplicate that work and pull toward implementation thinking.

---

## What triage is NOT

- Not investigating root cause
- Not mapping architecture or finding integration points
- Not proposing approaches or comparing options
- Not writing or reading source code
- Not producing design, specs, or tasks

If you are doing any of the above, stop — you are in specify's lane.

---

## Good vs bad plan behavior

**Good** — stays in lane:

```
User: the session export sometimes drops the last message

Plan: Sounds like a bug in export. Goal = exports include every message,
      including the last. Is the last message always dropped, or only in
      some cases (e.g. right after a tool call)? [asks a WHAT/WHEN question,
      no source reading] → classifies hotfix.
```

**Bad** — slips into specify/debug:

```
User: the session export sometimes drops the last message

Plan: Let me look at the export code... [reads apps/server/...] I see, the
      reducer doesn't flush the buffer on stream end. The fix is to add a
      final flush in exportSession at line 142... [← WRONG PHASE]
```

The second example does real work that specify/build will redo, and it produced nothing durable for `proposal.md`.

---

## Guardrails (quick reference)

- **Don't investigate how** to fix, build, or debug — that is specify's job.
- **Don't read source** outside the allowed reads above.
- **Don't propose approaches** or compare options — that is specify (brainstorming mode).
- **Don't write acceptance scenarios** — specify produces them with the spec deltas.
- **Do** capture intent, classify, and (for features) check `.sakti/specs/`.
- **Do** ask clarifying questions about _what_ and _why_, not _how_.
