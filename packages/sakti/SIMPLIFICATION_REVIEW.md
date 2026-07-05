# Sakti CLI Simplification Review

Review each feature below and mark **KEEP** or **REMOVE**.
Current total: ~18,000 lines across ~100 source files.

---

## 1. Workflow Commands — Skill/Instruction Generation

**CLI commands:** `status`, `instructions`, `templates`, `schemas`, `new change`

**Files:** `src/commands/workflow/` (7 files, 1,227 lines)

**What it does:** Generates enriched instruction text for AI agents. Each command outputs workflow instructions (onboard, propose, apply-change, verify-change, archive-change, etc.) that get embedded into skill files. `instructions [artifact]` prints the instruction text for a specific artifact. `new change <name>` scaffolds a new change directory. `status` shows artifact completion progress. `templates` lists template paths. `schemas` lists available workflow schemas.

**Why it existed:** The standalone CLI generated skill/command files for external AI tools (Claude Code, Cursor, etc.). Now that skill generation will be bundled in the desktop app, these commands are redundant.

**Depends on:** `src/core/templates/workflows/`, `src/core/artifact-graph/`, `src/core/planning-home.ts`

**If removed:** Also removes workflow templates (#2) and most of artifact-graph (#3). ~6,000 lines total.

---

## 2. Workflow Templates

**Files:** `src/core/templates/workflows/` (13 files, 3,772 lines)

**What it does:** Contains the actual instruction text for 13 workflow steps: `onboard`, `propose`, `new-change`, `continue-change`, `ff-change`, `apply-change`, `verify-change`, `archive-change`, `bulk-archive-change`, `sync-specs`, `explore`, `feedback`. Each file exports a function that generates markdown instruction text with variable interpolation (`planningHome`, `changeRoot`, `artifactPaths`, etc.).

**Why it existed:** Content source for the skill/instruction generation system (#1). These are the literal prompt templates that get written into `.sakti/skills/` files.

**Depends on:** Nothing (leaf nodes — pure string generation).

**If removed:** Dies with #1. Also remove `src/core/templates/skill-templates.ts` and `src/core/templates/index.ts` (orphaned after #1 removal).

---

## 3. Artifact Graph

**Files:** `src/core/artifact-graph/` (8 files, 1,224 lines)

**What it does:**
- `schema.ts` — Parses and validates workflow schema YAML files (which define artifact pipelines: proposal → design → specs → tasks, etc.)
- `resolver.ts` — Resolves which schema to use for a project, finds schema directories (package/user/project), resolves artifact outputs
- `graph.ts` — Builds dependency graph between artifacts (artifact A depends on artifact B)
- `instruction-loader.ts` (455 lines) — Loads and enriches instruction templates with context (planningHome, changeRoot, etc.) for the `instructions` command
- `index.ts` — Barrel exports

**Why it existed:** Schema resolution is used by `task-progress.ts` and `change-metadata.ts` to determine which artifacts a change should produce, and to track task completion. The instruction-loader is only used by the `instructions` command.

**Depends on:** `planning-home.ts`, `change-status-policy.ts`

**If removed:** `task-progress.ts` and `change-metadata.ts` lose schema resolution — would need simplification to either inline minimal schema logic or drop schema-awareness entirely. Can keep `schema.ts` + `resolver.ts` (170 lines) for schema resolution while removing `graph.ts` + `instruction-loader.ts` + `index.ts` (622 lines).

---

## 4. Schema Command

**CLI commands:** `schema which`, `schema validate`, `schema fork`, `schema init`

**Files:** `src/commands/schema.ts` (1,005 lines)

**What it does:** Manages workflow schema YAML files. `schema which [name]` shows where a schema resolves from (package/user/project). `schema validate [name]` validates schema structure. `schema fork <source> [name]` copies a schema for customization. `schema init <name>` creates a new project-local schema with interactive prompts.

**Why it existed:** Allows users to customize the artifact pipeline for their project. Schemas define which artifacts a change must produce (proposal, design, specs, tasks, etc.) and their dependency order.

**Depends on:** `src/core/artifact-graph/` (schema parsing/resolution)

**If removed:** If #1 (workflow commands) is removed, schema management is only useful for `task-progress` / `change-metadata` which use schema resolution. You could keep just the resolver (part of #3) without this interactive management command. 1,005 lines saved.

---

## 5. Store System

**CLI commands:** `store setup`, `store register`, `store unregister`, `store remove`, `store list`, `store doctor`

**Files:**
- `src/commands/store.ts` (759 lines)
- `src/core/store/operations.ts` (1,196 lines) — store CRUD, path expansion
- `src/core/store/registry.ts` (462 lines) — store registry state management
- `src/core/store/foundation.ts` (414 lines) — store metadata, validation, IDs
- `src/core/store/git.ts` (178 lines) — git operations for stores
- `src/core/store/errors.ts` (42 lines) — `StoreError` class

**What it does:** Multi-repository management. A "store" is a named, registered root directory containing a `.sakti/` folder. The system tracks stores in a global registry (`~/.local/share/sakti/stores/`), validates their identity, supports git integration, and allows `--store <id>` flags on other commands to target a specific store.

**Why it existed:** Allows users to manage spec-driven development across multiple projects from one CLI. The desktop app already manages projects/sessions, making this redundant.

**Depends on:** Deeply integrated. `root-selection.ts` uses `store/foundation.js` to resolve roots. `shared-output.ts` imports `StoreError`. `context.ts`, `doctor.ts`, `workset.ts`, `validate.ts` all reference stores.

**If removed:** Requires rewriting `root-selection.ts` to just "find nearest `.sakti/` dir" (drops ~300 lines of store resolution). `StoreError` must be replaced with a generic error class. `shared-gather.ts`, `shared-output.ts`, `context.ts` lose store awareness. This is the hardest cluster to remove — ~3,055 lines but high entanglement.

---

## 6. Worksets + Openers

**CLI commands:** `workset create`, `workset list`, `workset open`, `workset remove`

**Files:**
- `src/commands/workset.ts` (655 lines)
- `src/commands/workset-prompts.ts` (188 lines) — interactive prompts for workset creation
- `src/commands/workset-input.ts` (185 lines) — input parsing/validation for worksets
- `src/core/worksets.ts` (401 lines) — workset state, YAML persistence, lock files
- `src/core/openers.ts` (372 lines) — launches IDEs (VS Code, Cursor, etc.) with workset folders

**What it does:** A "workset" is a saved collection of stores/folders you want to work on together. `workset create` interactively composes a named view of folders. `workset open <name>` launches your IDE with those folders (as a workspace file or attached dirs). `workset list` shows saved worksets. `workset remove` deletes a saved workset (never the folders themselves).

**Why it existed:** Power-user CLI feature for combining specs from multiple projects and opening them in an IDE. The desktop app has its own project management UI.

**Depends on:** Store system (#5), openers. Only `cli/index.ts` registers these commands.

**If removed:** Fully isolated — no other code depends on worksets. 1,801 lines removed. If #5 (store) is also removed, this becomes even cleaner.

---

## 7. Config Command

**CLI commands:** `config path`, `config list`, `config get`, `config set`, `config profile`

**Files:** `src/commands/config.ts` (601 lines)

**What it does:** Views and modifies global Sakti configuration (`~/.config/sakti/config.yaml`). `config path` shows file location. `config list` shows all settings. `config get/set` reads/writes values. `config profile` switches between workflow profiles (core/custom) which control which skill files get generated.

**Why it existed:** Profile management was used by init/update to select which workflow skill files to install. Without init/update, profile switching is vestigial. Basic config get/set/path might still be useful for a bundled tool, but profile management is dead code.

**Depends on:** `src/core/profiles.ts` (#12), `src/core/config-schema.ts`, `src/core/config-prompts.ts` (#12)

**If removed:** If keeping basic `config get/set/path`, can strip profile management (~300 lines). If removing entirely, 601 lines.

---

## 8. Feedback Command

**CLI command:** `feedback <message>`

**Files:**
- `src/commands/feedback.ts` (208 lines)
- `src/core/templates/workflows/feedback.ts` (115 lines) — feedback workflow template

**What it does:** Collects user feedback (message + optional body) and sends it to a remote endpoint. Telemetry-adjacent feature.

**Why it existed:** Allows users to submit feedback from the CLI.

**Depends on:** Nothing.

**If removed:** 323 lines. No dependencies.

---

## 9. Doctor Command (KEEP — per user)

**CLI command:** `doctor`

**Files:** `src/commands/doctor.ts` (211 lines)

**What it does:** Health diagnostics — checks store registrations, metadata validity, git state, relationship health between referenced stores. Reports issues with actionable diagnostics.

**Depends on:** Store system (#5), `planning-home.ts` (#11), `relationship-health.ts`, `root-selection.ts`

---

## 10. Context Command

**CLI command:** `context`

**Files:** `src/commands/context.ts` (208 lines)

**What it does:** Outputs the "working set" — an agent-consumable brief (JSON or human listing) describing the root and its referenced stores. Can generate a `--code-workspace` file. Essentially a read-only view of declared relationships and available specs.

**Why it existed:** Provides AI agents with a structured overview of what specs/changes are available across stores.

**Depends on:** Store system (#5), `relationship-health.ts`, `working-set.ts`, `shared-gather.ts`

**If removed:** 208 lines. Also kills `src/core/working-set.ts` (92 lines) and `src/core/relationship-health.ts` (144 lines) if nothing else uses them.

---

## 11. Planning Home + Change Status Policy

**Files:**
- `src/core/planning-home.ts` (99 lines)
- `src/core/change-status-policy.ts` (79 lines)

**What it does:** `planning-home.ts` resolves where changes live (repo root with `.sakti/changes/`). `change-status-policy.ts` summarizes planning home state for workflow status output.

**Why it existed:** Abstraction layer for workflow commands to locate changes. In a simplified world, this is just `path.join(root, '.sakti', 'changes')`.

**Depends on:** Used by workflow commands (#1), doctor (#9), artifact-graph (#3), root-selection.

**If removed:** If #1 is removed, doctor can inline the 2 functions it needs. 178 lines.

---

## 12. Profiles + Config Prompts

**Files:**
- `src/core/profiles.ts` (50 lines) — defines `CORE_WORKFLOWS`, `ALL_WORKFLOWS`, `getProfileWorkflows`
- `src/core/config-prompts.ts` (39 lines) — interactive prompts for profile selection

**What it does:** Profile system maps workflow names (core/custom) to sets of skill files. `CORE_WORKFLOWS` lists the canonical set. Used by `config profile` command to select which workflow skills to install.

**Why it existed:** Init/update used profiles to decide which skill files to generate. Without init/update, this is vestigial.

**Depends on:** Only `config.ts` (#7) uses profiles.

**If removed:** Dies with #7's profile management, or standalone if config is simplified. 89 lines.

---

## 13. Global Config

**Files:** `src/core/global-config.ts` (172 lines)

**What it does:** Reads/writes `~/.config/sakti/config.yaml`. Stores feature flags, profile selection, and custom openers config. Provides `getGlobalConfig()`, `getGlobalConfigPath()`, `getGlobalDataDir()`.

**Why it existed:** Central config for the standalone CLI.

**Depends on:** Used by config command (#7), worksets (#6), openers, doctor (#9), store system (#5). `getGlobalDataDir()` has high fan-in (18 callers).

**If removed:** NOT fully removable — `getGlobalDataDir()` is used everywhere for the data directory. But the config file reading/writing and profile/openers config parsing could be stripped down. Partial removal possible.

---

## Summary Table

| # | Feature | Lines | Removeable? | Notes |
|---|---------|-------|-------------|-------|
| 1 | Workflow commands | 1,227 | Yes — dies with skill generation | |
| 2 | Workflow templates | 3,772 | Yes — content for #1 | |
| 3 | Artifact graph | 1,224 | Partial — keep schema resolver (170), remove loader (622) | task-progress needs schema |
| 4 | Schema command | 1,005 | Yes — if #1 removed | |
| 5 | Store system | 3,055 | Hard — high entanglement | root-selection rewrite needed |
| 6 | Worksets + openers | 1,801 | Yes — fully isolated | |
| 7 | Config command | 601 | Partial — keep get/set, remove profile | |
| 8 | Feedback | 323 | Yes — no dependencies | |
| 9 | Doctor | 211 | **KEEP** | |
| 10 | Context | 208 | Yes — kills working-set + relationship-health | |
| 11 | Planning home | 178 | Yes — if #1 removed | |
| 12 | Profiles + config prompts | 89 | Yes — vestigial | |
| 13 | Global config | 172 | Partial — keep data dir, strip config parsing | |

**Maximum removal:** ~13,000 lines → remaining ~5,000 lines
**Safe removal (no entanglement):** ~8,000 lines → remaining ~10,000 lines
