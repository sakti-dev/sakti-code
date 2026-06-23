## Why

Provider/model configuration is split across the wrong places: a DB table (`model_configs`) that AGENTS.md says should be a user-editable file, an `api-keys.json` file with no locking and a broken list endpoint (`GET /api/api-keys/` returns 404), and app `settings` trapped in a key/value DB table. Users cannot inspect or hand-edit their model setup. We also need a **profile** concept (per-mode model selection: intake/plan/build) so each project can pick a profile, but the current storage shape can't express it. Pi's config model (`~/.pi/agent/{auth,models,settings}.json` — one file per concern, secrets isolated with lock + `0600`, plain JSON elsewhere, no DB for config) is the proven template to follow.

## What Changes

- **BREAKING**: Config home moves from `~/.config/sakti-code/` to `~/.sakti/agent/` (pi-style). One-time migration of the existing `api-keys.json`.
- **BREAKING**: Credentials file renamed `api-keys.json` → `auth.json`. Writes become file-locked (`proper-lockfile`) with `mode 0o600`; reads return masked keys only. Fixes the `GET /api/api-keys/` 404 regression by replacing the route surface entirely.
- **NEW**: `profiles.json` — user-editable profiles mapping a **mode** (`default` required; `intake`/`plan`/`build` optional, mode-forward) to a `{ provider, model, thinkingLevel }` plus `hybrid { enabled, vision }`. A `defaultProfile` id selects the active one. Modes beyond `default` are ignored until the modes feature ships — no later schema migration.
- **BREAKING**: `projects` table gains a nullable `profileId` column (null → `defaultProfile`). Per-project model/provider selection is removed; selection happens via the project's profile.
- **BREAKING**: `model_configs` table dropped. Provider/model/thinkingLevel now live in `profiles.json`.
- **BREAKING**: Global app settings move from the `settings` key/value table to `settings.json` (pi-style; hand-editable, deep-mergeable). The `settings` table is **retained** solely for per-session runtime overrides (`session:{id}:*` keys, used by `per-session-settings`) — those are session state keyed by session id, not user-editable preferences, so they stay DB-backed.
- `sessions.modelId` + `sessions.thinkingLevel` **kept** as a snapshot copied at session creation from the resolved profile (so changing a profile mid-session doesn't disrupt a running conversation).
- `resolveModel` (agent-streaming) rewritten to resolve from `profiles.json` + `project.profileId` (current runtime mode when modes ship; `default` for now) with an in-memory cache to avoid disk reads per token.
- REST surface replaced: remove `/api/models/config*` and `/api/api-keys/*`; add `/api/profiles*`, `/api/auth*`, keep `/api/settings` (now file-backed).
- `models.json` (custom provider/model catalog overrides, ported from pi) is **deferred** — not in this change.

## Capabilities

### New Capabilities
- `provider-profiles`: Editable profiles mapping runtime mode → `{ provider, model, thinkingLevel }` with hybrid vision fallback; project → profile selection; file-backed at `~/.sakti/agent/profiles.json`.
- `app-config-files`: Pi-style config home (`~/.sakti/agent/`) with one JSON file per concern (`auth.json`, `profiles.json`, `settings.json`), locked/`0600` secrets, plain JSON elsewhere, env override of the dir.

### Modified Capabilities
- `database-schema`: Drop `model_configs` table; add nullable `projects.profileId`. Keep `sessions.modelId`/`thinkingLevel` (creation-time snapshots) and the `settings` table (now scoped to `session:*` keys only).
- `database-repos`: Remove the `models` config repo; narrow `SettingsRepo` to session-scoped keys (`getByPrefix` retained for `per-session-settings`); global settings move to a file store.
- `server-rest-api`: Remove `/api/models/config*` and `/api/api-keys/*`; add `/api/profiles*` and `/api/auth*`; `/api/settings` (global) becomes file-backed. `/api/sessions/:id/settings` (per-session) stays DB-backed and unchanged.
- `agent-streaming`: `resolveModel` reads `profiles.json` + `project.profileId` (mode-aware when modes ship) instead of `model_configs`.

## Impact

- **Code**: `apps/server/src/{lib,routes,context,create-server}`, `packages/db/src/{schema,repos}`, `apps/desktop/src/{components/settings, lib/api, stores}`, `packages/agent` (resolveModel entry point).
- **APIs**: Breaking REST changes (see above); Hono RPC client types regenerated from `App`.
- **Storage**: Two table drops + one column add (Drizzle migration); three new/renamed files under `~/.sakti/agent/`; one-time migration of any existing `~/.config/sakti-code/api-keys.json`.
- **Dependencies**: Add `proper-lockfile` (auth file locking) — matches pi's `auth-storage.ts`.
- **AGENTS.md**: Must be updated (currently states "Model config lives in the DB" and documents `/api/model-configs` + `/api/api-keys`).
- **Tests**: New tests for file stores (auth/profiles/settings) + routes; existing `model_configs`/`settings` repo tests removed; `resolveModel` tests updated.
