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

- [ ] **#4 Schema Command** (1,005 lines) — `schema which/validate/fork/init`. Only useful if users customize schemas. Candidate for removal if only default schema is used.
- [ ] **#5 Store System** (3,055 lines) — `store setup/register/unregister/remove/list/doctor`. Multi-repo management. Hardest to remove — deeply entangled in `root-selection.ts`. Desktop app handles projects itself.
- [ ] **#6 Worksets + Openers** (1,801 lines) — `workset create/list/open/remove` + IDE launchers. Fully isolated, no dependencies. Power-user CLI feature.
- [ ] **#7 Config Command** (601 lines) — `config path/list/get/set/profile`. Profile management is vestigial (init/update deleted). Basic get/set/path may be useful.
- [ ] **#8 Feedback** (323 lines) — `feedback <message>`. Telemetry-adjacent, no dependencies.
- [ ] **#9 Doctor** (211 lines) — **KEEP** per user decision.
- [ ] **#10 Context** (208 lines) — `context` command. Outputs working-set brief for AI agents. Kills `working-set.ts` + `relationship-health.ts` if removed.
- [ ] **#11 Planning Home** (178 lines) — Path resolution for change directories. Partially still needed by `status` command. Could inline the 2 functions.
- [ ] **#12 Profiles + Config Prompts** (89 lines) — Vestigial profile system, only used by `config profile`.
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

**What it does:** Manages workflow schema YAML files. Allows users to customize the artifact pipeline for their project.

**If removed:** 1,005 lines saved. Schema resolution (in artifact-graph) still works — this is just the management UI.

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

**Status:** PENDING DECISION

**CLI commands:** `workset create`, `workset list`, `workset open`, `workset remove`

**Files:**
- `src/commands/workset.ts` (655 lines)
- `src/commands/workset-prompts.ts` (188 lines)
- `src/commands/workset-input.ts` (185 lines)
- `src/core/worksets.ts` (401 lines)
- `src/core/openers.ts` (372 lines)

**If removed:** Fully isolated — no other code depends on worksets. 1,801 lines removed.

---

### 7. Config Command

**Status:** PENDING DECISION

**CLI commands:** `config path`, `config list`, `config get`, `config set`, `config profile`

**Files:** `src/commands/config.ts` (601 lines)

**If removed:** Profile management (~300 lines) is vestigial. Basic `config get/set/path` may still be useful for a bundled tool.

---

### 8. Feedback Command

**Status:** PENDING DECISION

**CLI command:** `feedback <message>`

**Files:** `src/commands/feedback.ts` (208 lines)

**If removed:** 208 lines, no dependencies.

---

### 9. Doctor Command

**Status:** KEEP (per user)

**CLI command:** `doctor`

**Files:** `src/commands/doctor.ts` (211 lines)

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

**Status:** PENDING DECISION

**Files:**
- `src/core/profiles.ts` (50 lines)
- `src/core/config-prompts.ts` (39 lines)

**If removed:** Dies with #7's profile management. 89 lines.

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
| 4 | Schema command | 1,005 | ⬜ Pending | Candidate for removal |
| 5 | Store system | 3,055 | ⬜ Pending | Hardest — high entanglement |
| 6 | Worksets + openers | 1,801 | ⬜ Pending | Fully isolated |
| 7 | Config command | 601 | ⬜ Pending | Profile mgmt vestigial |
| 8 | Feedback | 323 | ⬜ Pending | No dependencies |
| 9 | Doctor | 211 | ✅ Keep | User decision |
| 10 | Context | 208 | ⬜ Pending | Kills 2 more core files |
| 11 | Planning home | 178 | ⬜ Partial | Inline into status/doctor |
| 12 | Profiles | 89 | ⬜ Pending | Vestigial |
| 13 | Global config | 172 | ⬜ Partial | Keep data dir, strip config parsing |

**Removed so far:** ~16,279 lines deleted, ~2,055 lines added (skills)
**Remaining candidates:** ~9,531 lines if all pending items removed
