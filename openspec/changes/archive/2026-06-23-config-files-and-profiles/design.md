## Context

Provider/model configuration in sakti is currently scattered and partly broken:

- `model_configs` table (DB) stores provider + modelId + thinkingLevel per-project/global — but users can't inspect or hand-edit it, and AGENTS.md's stance ("API keys come from env, never the DB") implies config files, not opaque DB rows.
- `~/.config/sakti-code/api-keys.json` stores credentials but with no file locking and a broken list endpoint (`GET /api/api-keys/` returns 404; only PUT/DELETE work).
- The `settings` key/value table holds both global app prefs AND per-session runtime overrides (`session:{id}:*`), conflating two concerns.
- There is no way to express "use model X in plan mode, model Y in build mode" — the profile concept the user wants.

Pi (`openspec/references/pi/packages/coding-agent`) solves this with a clean, proven layout: one app config dir (`~/.pi/agent/`), one JSON file per concern (`auth.json`, `models.json`, `settings.json`), secrets isolated with `proper-lockfile` + `mode 0o600`, everything else plain editable JSON, and no DB for config (`config.ts:511-565`, `auth-storage.ts:49-169`, `settings-manager.ts:80-154`). We adopt that model.

A key constraint surfaced during spec review: `per-session-settings` stores runtime overrides (`auto_compaction`, `max_retries`, `steering_mode`, …) in the `settings` table under `session:{id}:*` keys. Those are session state keyed by UUID — not user-editable preferences — so they stay DB-backed. Only **global** app settings migrate to `settings.json`.

Modes (intake/plan/build) do not exist in the current app (verified: no references in `packages/db`, `apps/server`, `apps/desktop`). They are a future feature. Profiles are designed to be **mode-forward**: the `default` model key is always used today; `intake`/`plan`/`build` keys are optional and ignored until modes ship, with no later schema migration.

## Goals / Non-Goals

**Goals:**
- One config home at `~/.sakti/agent/`, pi-style, hand-editable JSON, one file per concern.
- Secrets isolated: `auth.json` written under file lock + `0600`; API never returns full keys, only masked.
- Introduce `profiles.json` (mode-forward) as the single source of model selection; `projects.profileId` picks the active profile.
- `resolveModel` reads profiles + project profile (mode-aware later), cached off the hot path.
- Global app settings editable via `settings.json`; per-session runtime settings stay DB-backed (unchained).
- Fix the `GET /api/api-keys/` 404 by replacing the whole credentials route surface.
- Migration of existing `api-keys.json` and global settings/model_config rows; old data preserved on failure.

**Non-Goals:**
- Modes (intake/plan/build) themselves — schema is mode-forward, feature lands separately.
- OAuth credential flow (copilot/bedrock) — current AGENTS.md exclusion holds; auth schema is API-key-only for now.
- `models.json` custom provider/model catalog overrides (deferred; port from pi later).
- Per-project settings override (pi's `.pi/settings.json` deep-merge) — global only.
- Per-profile OAuth account labels, model capability snapshots, MiniSearch selector UI.

## Decisions

### D1. Config dir: `~/.sakti/agent/` (pi-style, not XDG)
`join(homedir(), ".sakti", "agent")`. Env override `SAKTI_AGENT_DIR` (mirrors pi's `PI_CODING_AGENT_DIR`). **Alt considered:** keep XDG `~/.config/sakti-code/` — rejected: user explicitly wants the pi look/feel and a self-contained app home. Cost: one-time migration of the existing XDG `api-keys.json`.

### D2. File-per-concern split
- `auth.json` — provider → API key. Secrets. `proper-lockfile` on every read/modify/write; `mode 0o600`; parent dir `0o700`; `{}` if absent (mirrors pi `auth-storage.ts:49-122`).
- `profiles.json` — `{ defaultProfile, profiles: { id: { name, models: { default, intake?, plan?, build? }, hybrid } } }`. Plain JSON (no lock — last-write-wins, single-user desktop).
- `settings.json` — global app preferences (theme, etc.). Plain JSON.
**Alt:** single `config.json` blob — rejected (pi's split lets secrets be the only locked file and keeps the rest diff-friendly).

### D3. Profiles schema is mode-forward
```
profiles.json:
  defaultProfile: "balanced"          # which profile id is active when project.profileId is null
  profiles:
    balanced:
      name: "Balanced"
      models:
        default: { provider, model, thinkingLevel }   # REQUIRED, used today
        intake?:  { provider, model, thinkingLevel? }  # optional, ignored until modes ship
        plan?:    { provider, model, thinkingLevel? }
        build?:   { provider, model, thinkingLevel? }
      hybrid?: { enabled, vision: { provider, model } }
```
Resolution order: `project.profileId ?? defaultProfile` → profile → `models[<current mode>] ?? models.default`. Today `<current mode>` is always `default`. **Alt:** ship modes first — rejected (user wants persistence now, modes later; schema carries forward with no migration).

### D4. Credentials never leave the file except into `process.env`
`auth.json` is the source of truth. On startup, `loadIntoEnv()` reads it and sets `process.env[envVar]` for each provider (existing behavior). `set()` writes file + env; `delete()` removes both. REST reads return only `{ provider, envVar, hasKey, maskedKey }` (last 4 chars) — never the full key. pi-ai's `getEnvApiKey()` resolves keys from env at request time (unchanged). **Alt:** pass keys explicitly to pi-ai per request — rejected (larger refactor; env mirror is pi's proven path).

### D5. `resolveModel` reads profiles + cache
Rewritten to: load `projects.profileId` (DB) → resolve profile id → load profile (file, cached) → pick `models[mode] ?? models.default` → `getModel(provider, modelId)`. Cache keyed by file `mtimeMs` so an external edit to `profiles.json` is picked up without a server restart (invalidate on mtime change). `thinkingLevel` resolved alongside. Throws if profile/`default` missing. **Alt:** live-resolve per request, no cache — rejected (disk read per token on the hot path).

### D6. Session model is a snapshot
`sessions.modelId` + `sessions.thinkingLevel` are copied from the resolved profile at session creation and never auto-updated. Editing a profile mid-session does NOT change a running conversation. User can still explicitly change a session's model via `PATCH /api/sessions/:id` (existing). **Alt:** always live-resolve from profile — rejected (a profile edit would silently yank the model out from under a running agent).

### D7. `settings` table retained for session-scoped keys only
Global app settings migrate to `settings.json`; the `settings` table keeps its schema but its use narrows to `session:{id}:*` runtime overrides (`per-session-settings` is unchanged). `SettingsRepo` keeps `getByPrefix` (used by per-session settings); global `get/set/getAll` move to a new `SettingsFileStore`. **Alt:** migrate session keys to a `session_settings` table or JSON column — rejected (scope creep; per-session-settings works as-is).

### D8. REST surface
Remove `/api/models/config*`, `/api/api-keys/*`. Add:
- `GET /api/profiles` → whole `profiles.json` (parsed, validated).
- `PUT /api/profiles` → replace whole file (validated against schema; atomic write).
- `GET /api/auth` → masked list (provider, envVar, hasKey, maskedKey).
- `POST /api/auth/:provider` `{ key }` → write; `DELETE /api/auth/:provider` → remove.
- `GET /api/settings` / `PUT /api/settings` → global, file-backed (was DB-backed).
`/api/sessions/:id/settings` (per-session) unchanged. Hono RPC types flow via `App`. **Alt:** per-profile CRUD routes (`POST /api/profiles/:id`) — rejected for now (whole-file PUT matches the "editable file" model and is simpler; per-profile CRUD can be added later).

## Risks / Trade-offs

- **Concurrent writes while user hand-edits** → last-write-wins for `profiles.json`/`settings.json`. Mitigation: cache keyed on mtime (D5) so a hand edit is reflected on next read; UI writes go through the same store (no double-source). Acceptable for single-user desktop.
- **`resolveModel` cache staleness** → stale model after a profile edit. Mitigation: invalidate on file mtime change (D5); tests cover the invalidation path.
- **Migration data loss** → user loses keys/prefs on first launch post-upgrade. Mitigation: migration is best-effort and **non-destructive** — old `~/.config/sakti-code/api-keys.json` and old DB rows are left in place on any failure; `auth.json` is written from the migrated content only after a successful parse.
- **Breaking REST changes** → existing desktop build breaks. Mitigation: desktop is the only client; server + desktop ship together; Hono RPC type errors surface every broken call site at typecheck.
- **`proper-lockfile` dependency** → new dep. Mitigation: pi uses it for the same purpose (`auth-storage.ts`); it's a single well-maintained pure-JS lib; lockfile lives next to `auth.json`.
- **AGENTS.md drift** → docs still describe DB-backed model config + `/api/api-keys`. Mitigation: this change updates AGENTS.md in the same commit.

## Migration Plan

On server startup, before first config read, run once (idempotent, guarded by a sentinel so it doesn't repeat):

1. **Dir + auth**: ensure `~/.sakti/agent/` exists (`0700`). If `~/.sakti/agent/auth.json` does NOT exist AND legacy `~/.config/sakti-code/api-keys.json` exists, copy (not move) the legacy file's parsed content into `auth.json` (`0600`). On any parse error, leave the legacy file and proceed with empty auth.
2. **profiles.json**: if it does NOT exist, seed it. If a global `model_configs` row (projectId null) exists, derive `defaultProfile` from it; otherwise write a minimal `{ defaultProfile: "default", profiles: { default: { name: "Default", models: { default: { provider: <inferred>, model: <inferred> } } } } }` (no provider/model if none inferable — UI prompts the user).
3. **settings.json**: if it does NOT exist, seed from any global `settings` table rows whose key does NOT start with `session:`. Leave `session:*` rows in the DB (still used by per-session-settings).
4. **DB**: drop `model_configs` table (its data was migrated to profiles.json in step 2). Keep `settings` table (session-scoped rows remain). Add `projects.profileId` column (nullable).
5. Sentinel: write `~/.sakti/agent/.migrated` so steps 1-4 never repeat.

Rollback: the migration is copy-based (legacy files/rows preserved), so rolling back means reverting the code; data is intact. No destructive step.

## Resolved Questions

- **Profiles REST granularity** — whole-file `PUT /api/profiles` only. `profiles.json` is small and is the source of truth; the UI reads whole, edits in memory, writes whole (atomic). Per-profile CRUD would need server-side merge + conflict handling for no benefit on a single-user desktop. Matches pi's whole-document model for `settings.json`/`models.json`.
- **`thinkingLevel` location** — co-located with each model entry in `profiles.json` (e.g. `models.default.thinkingLevel`). Keeps a model and its tuning together.
- **Lockfile placement** — `auth.json.lock` next to `auth.json` (matches pi).
- **Env override name** — `SAKTI_AGENT_DIR` (mirrors pi's `PI_CODING_AGENT_DIR`).
