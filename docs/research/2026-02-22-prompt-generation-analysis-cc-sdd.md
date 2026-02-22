# Prompt Generation Analysis: Why cc-sdd Produces Strong Specs

## Purpose

This document analyzes how `cc-sdd` prompt design produces high-quality `requirements.md`, `research.md`, `design.md`, and `tasks.md` outputs.

Focus:

- Prompt mechanics, not marketing
- Repeatable patterns we can adopt
- Concrete mapping from prompt structure to artifact quality

## Scope

Analyzed prompt and rule sources include:

- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-requirements.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-design.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-tasks.md`
- `cc-sdd/tools/cc-sdd/templates/agents/codex/commands/kiro-spec-impl.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/tasks-generation.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/design-review.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/rules/gap-analysis.md`
- `cc-sdd/tools/cc-sdd/templates/shared/settings/templates/specs/*.md`

Representative outputs reviewed:

- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/requirements.md`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/research.md`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/design.md`
- `cc-sdd/.kiro/specs/customer-support-rag-backend-en/tasks.md`

---

## Core Thesis

The output quality is not from a single “magic prompt.”
It comes from a **prompt system architecture** composed of:

1. A strict phase workflow
2. Deterministic context loading requirements
3. Strong document templates
4. Rule files that constrain generation behavior
5. Explicit metadata update steps (`spec.json`)
6. Safety/fallback pathways
7. Output format contracts

In short:

- They constrain the model's search space.
- They externalize quality policy into reusable rule files.
- They force context hydration before generation.

---

## Prompt Pattern Breakdown

### Pattern 1: Role + Mission + Success Criteria

Every major prompt starts with:

- Mission
- Success criteria
- Explicit phase objective

Effect:

- The model receives a short optimization target before details.
- This reduces wandering and over-production.

Adoption note for us:

- Keep this section but tie success criteria to executable checks where possible.

### Pattern 2: Ordered Execution Steps

Prompts are highly procedural:

- Step 1 load context
- Step 2 read rules/templates
- Step 3 generate
- Step 4 update metadata

Effect:

- The model behaves more like a deterministic pipeline.
- Missing steps become easier to detect and debug.

Adoption note:

- Mirror this pattern in our planner prompts, but keep core invariants in code.

### Pattern 3: Mandatory Context Hydration

Prompts repeatedly require reading:

- spec files
- all steering files
- templates
- relevant rule files

Effect:

- Better grounding in project constraints.
- Fewer hallucinated architecture choices.

Adoption note:

- Our prompt stack should explicitly enumerate required context files per phase.
- Add a checklist in tool output showing what was loaded.

### Pattern 4: Separation of Templates and Rules

`templates/` define output structure.
`rules/` define generation behavior and quality constraints.

Effect:

- Teams can change format without changing process logic.
- Rules evolve independently of document shape.

Adoption note:

- This is one of their strongest design choices and should be adopted.

### Pattern 5: Clear Constraints and Non-Goals

Prompts explicitly state what not to do, for example:

- design should not contain implementation code
- requirements should focus on WHAT not HOW

Effect:

- Better phase boundary discipline.

Adoption note:

- Include “forbidden outputs” in each phase prompt.

### Pattern 6: Output Description Contracts

Each prompt ends with required summary format:

- status
- artifact path
- next action
- concise length limit

Effect:

- Predictable UX for operators.
- Easier tool chaining.

Adoption note:

- Add explicit output schemas for plan/build mode interactions.

### Pattern 7: Safety and Fallback Scenarios

Prompts define behavior for:

- missing files
- unapproved prior phases
- missing templates
- ambiguous inputs

Effect:

- Fewer dead-ends in conversational workflows.

Adoption note:

- Keep these; also map each fallback to typed tool error codes where possible.

### Pattern 8: Metadata Mutation Instructions

Prompts include concrete metadata writes to `spec.json`.

Effect:

- Workflow state remains visible and recoverable.

Adoption note:

- We should mirror runtime state to file while keeping DB canonical.

---

## Why Their Example Outputs Feel Strong

### Requirements Quality Drivers

Observed in output:

- Requirements grouped by capability areas.
- Each requirement has objective + multiple acceptance criteria.
- Criteria are concrete and test-oriented.

Prompt source of quality:

- EARS-format guidance
- requirement template structure
- explicit generation constraints

### Design Quality Drivers

Observed in output:

- Structured architecture and component contracts
- flow diagrams
- requirement traceability
- explicit risks and design decisions

Prompt source of quality:

- `design.md` template is very rich
- design prompt mandates discovery phase
- research and design are separated

### Tasks Quality Drivers

Observed in output:

- clear numbered hierarchy
- requirement mapping lines
- parallel markers `(P)`
- test and integration emphasis

Prompt source of quality:

- strict task generation rules
- parallel analysis rules
- task template with required formats

### Research Quality Drivers

Observed in output:

- source links
- findings and implications
- alternatives with tradeoffs

Prompt source of quality:

- design prompt forces discovery and persistence to `research.md`
- explicit instruction to consult external references when needed

---

## Prompt System Qualities Worth Reusing

### Reuse Candidate A: “Read First, Write Last” policy

Why good:

- Prevents premature generation.
- Encourages full context loading.

How to adopt:

- Add this policy line to all generation prompts.
- Add model output checklist confirming read paths.

### Reuse Candidate B: “Traceability as mandatory footer”

Why good:

- Increases reviewability.
- Keeps artifacts linked.

How to adopt:

- Require every generated task block to end with requirement IDs.
- Enforce in parser/compiler.

### Reuse Candidate C: “Decision records with alternatives”

Why good:

- Improves design auditability.

How to adopt:

- Require at least N architecture decisions with rationale/trade-offs in design phase.

### Reuse Candidate D: “Phase gate narrative in outputs”

Why good:

- Keeps users oriented in long workflows.

How to adopt:

- Standardize status responses in our tools:
  - current phase
  - artifact updated
  - next command

### Reuse Candidate E: “Macro mode with explicit caveats”

Why good:

- Speeds iteration for low-risk work.

How to adopt safely:

- interactive by default
- auto mode explicit
- auto mode emits “skipped-gates” warning

---

## Prompt Weaknesses We Should Avoid Copying

### Weakness 1: Over-reliance on prompt compliance

Risk:

- Critical invariants become model-dependent.

Countermeasure:

- keep hard checks in code for cycles, mapping integrity, and mode transitions.

### Weakness 2: Extremely long monolithic command prompts

Risk:

- Maintenance burden and instruction collisions.

Countermeasure:

- split into reusable policy blocks and concise command wrappers.

### Weakness 3: Heuristic implementation validation via conversation history

Risk:

- May miss work or infer incorrectly.

Countermeasure:

- validate against persisted runtime/task DB state first.

---

## Prompt Architecture We Should Implement (Proposed)

### Layered Prompt Stack

1. Core phase prompt (small)
2. Shared policy blocks (rules)
3. Artifact template
4. Runtime tool checks (hard)
5. Structured output schema

### Phase Prompt Blueprint

For each phase, include fixed sections:

- Role
- Mission
- Inputs
- Required context files
- Required rule files
- Required output artifact and structure
- Hard constraints
- Fallback behavior
- Output summary schema

### Minimal Example Blueprint (Design Phase)

- Role: planner-design agent
- Mission: convert approved requirements into architecture decisions and interface contracts
- Required reads:
  - requirements.md
  - steering/\*.md
  - design template
  - design rules
- Required outputs:
  - design.md updated
  - optional research.md updated
- Constraints:
  - no implementation code
  - map every requirement ID
  - include risks and alternatives
- Output summary:
  - status
  - key decisions
  - unresolved questions
  - next step

---

## Concrete Mapping: Prompt Feature -> Output Signal

| Prompt Feature                       | Output Signal                   | Seen in cc-sdd examples |
| ------------------------------------ | ------------------------------- | ----------------------- |
| Mandatory context loading            | fewer project-agnostic sections | yes                     |
| Rich design template                 | consistent section quality      | yes                     |
| Rules for task granularity           | actionable tasks                | yes                     |
| Requirement traceability instruction | explicit req references         | yes                     |
| Discovery required before design     | strong research artifact        | yes                     |
| Safety/fallback blocks               | clearer operator guidance       | yes                     |
| Output schema contract               | predictable command summaries   | yes                     |

---

## Implementation Recommendations for Our Prompts

### Priority 1 (Immediate)

- Introduce settings-based template/rule loading contract.
- Add explicit “read-first/write-last” in requirements/design/tasks prompts.
- Add required output summary schemas.

### Priority 2

- Add research phase behavior into design flow.
- Add task parallel marker policy and parser support.
- Add fallback matrices for missing prerequisites.

### Priority 3

- Add quick orchestration prompt wrapper with interactive default.
- Add localized output policy if needed.

---

## Quality Checklist for Our Prompt Rewrites

Before accepting a rewritten prompt, check:

- Does it define mission and success criteria?
- Does it list exact required context files?
- Does it reference template and rules files?
- Does it include forbidden outputs?
- Does it include fallback behavior?
- Does it require deterministic output summary shape?
- Are critical invariants still enforced in code instead of prompt text?

---

## Suggested Next Task

Use this analysis together with:

- `docs/research/2026-02-22-adopt-vs-skip-implementation-diff.md`

to implement:

1. prompt/rule/template contract in our planner flow
2. parser/compiler enhancements for task metadata
3. validation tool outputs with explicit summary schemas

---

## Closing

What looks “marvelous” in cc-sdd outputs is mostly disciplined prompt systems engineering:

- strict phase boundaries
- strong templates
- reusable rule packs
- enforced context hydration
- consistent output contracts

We can replicate that quality while keeping our stronger runtime correctness model.
