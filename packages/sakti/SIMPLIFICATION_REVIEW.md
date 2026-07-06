# Sakti CLI Simplification Review

Track progress on simplifying `packages/sakti/`.
Current total: ~12,000 lines (down from ~18,000 at start).

---

## Checklist

### Completed

- [x] **Telemetry** — Removed `src/telemetry/`, `posthog-node` dep, all tracking hooks
- [x] **Init/Update commands** — Removed init wizard, update refresh, command-generation adapters (10,834 lines)
- [x] **UI + Prompts** — Removed `src/ui/` (ascii art, welcome screen), `src/prompts/` (custom multi-select)
- [x] **#1 Workflow Commands** (partial) — Removed `instructions`, `templates`, `schemas` commands. Kept `new change` + `status` scaffolding
- [x] **#2 Workflow Templates** — Deleted all 13 template files + `skill-templates.ts` (3,772 lines)
- [x] **#3 Artifact Graph** (partial) — Removed `instruction-loader.ts` (455 lines). Kept `schema.ts`, `resolver.ts`, `graph.ts`. Added trimmed `change-status.ts`
- [x] **Bundled Skills** — Created 11 `sakti-*` skills in `src/skills/` with inlined artifact guidance (replaces CLI instruction generation)

### Remaining

- [x] **#4 Schema Command** (1,005 lines) — REMOVED. Management UI (which/validate/fork/init) deleted; diagnostics folded into doctor. Reusable `validate.ts` extracted to artifact-graph.
- [ ] **#5 Store System** (3,055 lines) — `store setup/register/unregister/remove/list/doctor`. Multi-repo management. Hardest to remove — deeply entangled in `root-selection.ts`. Desktop app handles projects itself.
- [x] **#6 Worksets + Openers** (1,801 lines) — REMOVED. Fully isolated, no dependencies. Power-user CLI feature.
- [x] **#7 Config Command** (601→246 lines) — SIMPLIFIED. Profile management stripped; basic get/set/path kept.
- [x] **#8 Feedback** (323 lines) — REMOVED. Telemetry-adjacent, no dependencies.
- [x] **#9 Doctor** (211→~170 lines) — REWRITTEN. Stripped all store/relationship checks (irrelevant to single-project use case). Now: config validity + schema resolvability + template existence. Uses store-free root finding.
- [ ] **#10 Context** (208 lines) — `context` command. Outputs working-set brief for AI agents. Kills `working-set.ts` + `relationship-health.ts` if removed. (Note: doctor no longer uses relationship-health; only context.ts does.)
- [ ] **#11 Planning Home** (178 lines) — Path resolution for change directories. Partially still needed by `status` command. Could inline the 2 functions.
- [x] **#12 Profiles + Config Prompts** (89 lines) — REMOVED (profiles.ts). Note: `config-prompts.ts` kept — misnamed, contains `serializeConfig()` needed by `new change`. Stripped `config profile` subcommand + helpers from config.ts.
- [ ] **#13 Global Config** (172 lines) — `getGlobalDataDir()` is high fan-in (keep), config file parsing could be stripped.

---

## Feature Details

### 1. Workflow Commands — Skill/Instruction Generation

**Status:** PARTIALLY REMOVED

**Removed:** `instructions`, `templates`, `schemas` commands (~684 lines)
**Kept:** `new change` (scaffolding), `status` (artifact completion check) — needed by bundled skills

**Files:** `src/commands/workflow/` — was 7 files / 1,227 lines, now 4 files / ~540 lines

---

### 2. Workflow Templates

**Status:** REMOVED

All 13 template files + `skill-templates.ts` + `index.ts` deleted (3,772 lines). Content now lives in bundled skill files at `src/skills/`.

---

### 3. Artifact Graph

**Status:** PARTIALLY REMOVED

**Removed:** `instruction-loader.ts` (455 lines) — replaced by trimmed `change-status.ts` (179 lines, only `loadChangeContext` + `formatChangeStatus`)
**Kept:** `schema.ts`, `resolver.ts`, `graph.ts`, `state.ts`, `outputs.ts`, `types.ts` — needed by `task-progress.ts` and `change-metadata.ts` for schema resolution

**Files:** `src/core/artifact-graph/` — was 8 files / 1,224 lines, now 7 files / ~948 lines

---

### 4. Schema Command

**Status:** PENDING DECISION

**CLI commands:** `schema which`, `schema validate`, `schema fork`, `schema init`

**Files:** `src/commands/schema.ts` (1,005 lines)

### 4. Schema Command

**Status:** REMOVED

Deleted `src/commands/schema.ts` (1,005 lines) — `schema which/validate/fork/init` management UI. Extracted reusable `validateSchema` + `resolveSchemaLocation` into `src/core/artifact-graph/validate.ts` (161 lines), now used by doctor. The schema resolver (`resolver.ts`, `schema.ts`) stays — `status`, `new change`, and `task-progress` need it at runtime.

---

### 5. Store System

**Status:** PENDING DECISION

**CLI commands:** `store setup`, `store register`, `store unregister`, `store remove`, `store list`, `store doctor`

**Files:**
- `src/commands/store.ts` (759 lines)
- `src/core/store/operations.ts` (1,196 lines)
- `src/core/store/registry.ts` (462 lines)
- `src/core/store/foundation.ts` (414 lines)
- `src/core/store/git.ts` (178 lines)
- `src/core/store/errors.ts` (42 lines)

**What it does:** Multi-repository management. A "store" is a named, registered root directory containing a `.sakti/` folder.

**If removed:** ~3,055 lines but high entanglement. Requires rewriting `root-selection.ts` to drop store resolution. `StoreError` must be replaced.

---

### 6. Worksets + Openers

**Status:** REMOVED

Deleted all 5 source files + 4 test files (2,098 source lines + 2,005 test lines). Fully isolated — no other code depended on it.

---

### 7. Config Command

**Status:** SIMPLIFIED (601 → ~246 lines)

**Kept:** `config path/list/get/set/unset/reset/edit` — basic config CRUD.
**Removed:** `config profile` subcommand + all profile helper functions + profile display in `config list`.

---

### 8. Feedback Command

**Status:** REMOVED

Deleted `src/commands/feedback.ts` (208 lines) + test (429 lines). No dependencies.

---

### 9. Doctor Command

**Status:** REWRITTEN (211 → ~170 lines)

Rewritten from a multi-repo relationship-health checker into a project-setup health checker. Stripped all store/reference/registry/pointer checks (irrelevant to single-project use case). Removed dependencies on store/foundation, store/git, relationship-health, shared-gather, root-selection.

**New checks:** config.yaml present + valid + has schema field; schema resolvable from project/user/package; schema structure valid + templates exist. Uses store-free `findRepoPlanningRootSync` for root finding.

---

### 10. Context Command

**Status:** PENDING DECISION

**CLI command:** `context`

**Files:** `src/commands/context.ts` (208 lines)

**If removed:** Also kills `src/core/working-set.ts` (92 lines) and `src/core/relationship-health.ts` (144 lines).

---

### 11. Planning Home + Change Status Policy

**Status:** PARTIALLY NEEDED

**Files:**
- `src/core/planning-home.ts` (99 lines) — still used by `status` command
- `src/core/change-status-policy.ts` (79 lines) — used by `change-status.ts`

**If removed:** Could inline the 2-3 functions needed by `status` and `doctor`.

---

### 12. Profiles + Config Prompts

**Status:** REMOVED (profiles.ts only)

**Removed:** `src/core/profiles.ts` (50 lines) + `config profile` subcommand + profile helper functions in config.ts + profile display in `config list`.
**Kept:** `src/core/config-prompts.ts` — despite the misleading name, it contains `serializeConfig()` used by `new change` scaffolding (via `sakti-root.ts`). Not a prompt file.

**Note:** `profile`/`delivery`/`workflows` fields remain in `global-config.ts` and `config-schema.ts` as orphaned schema keys (harmless; nothing writes them now). Can be cleaned in a later pass.

---

### 13. Global Config

**Status:** PARTIAL REMOVAL POSSIBLE

**Files:** `src/core/global-config.ts` (172 lines)

**If removed:** `getGlobalDataDir()` is high fan-in (18 callers) — must keep. Config file parsing and profile/openers config could be stripped.

---

## Summary

| # | Feature | Lines | Status | Action |
|---|---------|-------|--------|--------|
| — | Telemetry | ~919 | ✅ Done | Removed |
| — | Init/Update | ~10,834 | ✅ Done | Removed |
| — | UI + Prompts | ~754 | ✅ Done | Removed |
| — | Bundled Skills | +2,055 | ✅ Done | Created 11 sakti-* skills |
| 1 | Workflow commands | 1,227 | ✅ Partial | Removed instruction-gen, kept scaffold |
| 2 | Workflow templates | 3,772 | ✅ Done | Deleted, content in skills |
| 3 | Artifact graph | 1,224 | ✅ Partial | Removed loader, kept resolver |
| 4 | Schema command | 1,005 | ✅ Done | Management UI removed, validate.ts extracted to artifact-graph |
| 5 | Store system | 3,055 | ⬜ Pending | Hardest — high entanglement |
| 6 | Worksets + openers | 1,801 | ✅ Done | Fully isolated, removed |
| 7 | Config command | 601 | ✅ Partial | Stripped profile mgmt, kept get/set/path |
| 8 | Feedback | 323 | ✅ Done | No dependencies, removed |
| 9 | Doctor | 211 | ✅ Rewritten | Stripped store checks, now config+schema health |
| 10 | Context | 208 | ⬜ Pending | Kills 2 more core files (only remaining relationship-health user) |
| 11 | Planning home | 178 | ⬜ Partial | Inline into status |
| 12 | Profiles | 89 | ✅ Done | Vestigial, removed (config-prompts.ts kept) |
| 13 | Global config | 172 | ⬜ Partial | Keep data dir, strip config parsing |

**Removed so far:** ~23,247 lines deleted, ~2,216 lines added (skills + validate.ts)
**Remaining candidates:** ~3,624 lines if all pending items removed (#5, #10, #11, #13)
