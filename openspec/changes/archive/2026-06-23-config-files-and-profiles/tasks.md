## 1. Setup and dependencies

- [x] 1.1 Add `proper-lockfile` to `apps/server` dependencies (used by auth file locking); verify it resolves under the `nub` toolchain.
- [x] 1.2 Create `apps/server/src/lib/config-dirs.ts` exporting `getAgentDir()` → `join(homedir(), ".sakti", "agent")` with `SAKTI_AGENT_DIR` env override; export per-file path helpers `getAuthPath()`, `getProfilesPath()`, `getSettingsPath()`, `getMigratedSentinelPath()`. Unit-test the env override and the default path.

## 2. File stores (TDD)

- [x] 2.1 Write `apps/server/src/lib/auth-store.ts` (`AuthStore`): `list()` → masked entries, `set(provider, key)`, `delete(provider)`, `loadIntoEnv()`. Backed by `auth.json` under `proper-lockfile` + mode `0o600`; parent dir `0o700`; `{}` if absent. Provider→envVar map mirrors pi-ai. Write failing tests first (masked list, set/delete round-trip, env sync, unknown/empty rejected, concurrent writes serialized).
- [x] 2.2 Write `apps/server/src/lib/profiles-store.ts` (`ProfilesStore`): `read()`, `writeAll(parsed)` (atomic temp+rename), schema validation (typebox: `defaultProfile` required, `profiles[id].models.default` required, optional `intake`/`plan`/`build`/`hybrid`). Plain JSON, no lock (mtime-tracked). Failing tests first: valid round-trip, invalid body rejected without touching file, malformed JSON rejected, missing `default` model rejected on resolution.
- [x] 2.3 Write `apps/server/src/lib/settings-file-store.ts` (`SettingsFileStore`): `read()`, `update(partial)` (deep-merge), atomic write. Failing tests first: deep-merge round-trip, invalid body rejected.
- [x] 2.4 Add a profile resolver module `apps/server/src/lib/profile-resolver.ts`: `resolveModelRef(profiles, profileId, mode)` → `{ provider, model, thinkingLevel }` using `profileId ?? defaultProfile` then `models[mode] ?? models.default`. Pure function (no I/O). Tests cover default, override, mode fallback, missing-default error.

## 3. Schema + repo changes (TDD)

- [x] 3.1 Update `packages/db/src/schema.ts`: drop `modelConfigs`; add nullable `profileId` text column to `projects` (no SQL FK). Update the schema "exports all tables" test to assert `modelConfigs` is gone and `projects.profileId` exists.
- [x] 3.2 Remove `ModelConfigRepo` and its tests from `packages/db/src/repos`. Narrow `SettingsRepo` tests to assert it is used only for `session:*` keys (keep `getByPrefix`). Update `packages/db/src/repos/index.ts` exports.
- [x] 3.3 Add a Drizzle migration for the DB: drop `model_configs` table; add `projects.profile_id` column. Verify `initDatabase` applies it cleanly on an existing DB.

## 4. One-time migration (TDD)

- [x] 4.1 Write `apps/server/src/lib/config-migration.ts`: idempotent `runMigration(agentDir, { legacyKeysPath, db, profilesStore, settingsFileStore })` guarded by `~/.sakti/agent/.migrated` sentinel. Steps: (a) copy legacy `~/.config/sakti-code/api-keys.json` → `auth.json` if absent; (b) seed `profiles.json` from global `model_configs` row if present, else minimal default; (c) seed `settings.json` from non-`session:` `settings` rows; (d) write sentinel. Non-destructive: never delete legacy sources; skip+leave on parse error. Failing tests first (first-run, idempotent re-run, corrupt legacy skipped, per-source independence).

## 5. REST routes (TDD)

- [x] 5.1 Replace `apps/server/src/routes/api-keys.ts` with `apps/server/src/routes/auth.ts`: `GET /api/auth`, `POST /api/auth/:provider` `{ key }`, `DELETE /api/auth/:provider`. Validation via `@hono/typebox-validator`. Failing tests first: masked list, set/delete, unknown/empty rejected, 404 on delete-missing.
- [x] 5.2 Add `apps/server/src/routes/profiles.ts`: `GET /api/profiles`, `PUT /api/profiles` (validate-then-atomic-write). Failing tests first: get parsed, put replaces, invalid body leaves file unchanged.
- [x] 5.3 Convert `apps/server/src/routes/settings.ts` to file-backed (`SettingsFileStore`): `GET /api/settings`, `PUT /api/settings` (deep-merge). Keep `/api/sessions/:id/settings` DB-backed and unchanged. Failing tests first: file round-trip, invalid body rejected, session settings still DB-backed.
- [x] 5.4 Remove `apps/server/src/routes/models/models.ts` (`modelConfigRoutes`) and its tests.

## 6. Model resolution + server wiring

- [x] 6.1 Rewrite `resolveModel` in `packages/agent` (or `apps/server` agent-streaming, wherever it currently lives) to: load `project.profileId` (DB) → load `profiles.json` via `ProfilesStore` (cached by `mtimeMs`) → `resolveModelRef(profiles, profileId, "default")` → `getModel(provider, modelId)`. Throw on missing profile/default. Update existing `resolveModel` tests to use a `ProfilesStore` fixture instead of `ModelConfigRepo`.
- [x] 6.2 Update `apps/server/src/context.ts` (`ServerContext`): replace `apiKeys` with `auth` (`AuthStore`); add `profiles` (`ProfilesStore`) and `settingsFile` (`SettingsFileStore`); remove `repos.models`. Drop the `ModelConfigRepo` from `repos`.
- [x] 6.3 Update `apps/server/src/create-server.ts`: construct `AuthStore`, `ProfilesStore`, `SettingsFileStore` from `getAgentDir()`; call `auth.loadIntoEnv()`; call `runMigration(...)` once before first config read.
- [x] 6.4 Update `apps/server/src/app.ts`: remove `modelConfigRoutes` and `createApiKeyRoutes`; register `authRoutes`, `profilesRoutes` (under `/api`); keep file-backed `settingsRoutes`. Confirm `hcWithType<App>` types flow.

## 7. Desktop UI (deferred to follow-up change)

> Tasks 7.1-7.3 are scoped out of this change. The server-side API is complete
> and tested (`/api/auth`, `/api/profiles`, file-backed `/api/settings`). The
> desktop SolidJS components still reference the old endpoints and will be
> reworked in a separate change (`desktop-ui-profiles-auth`).

- [~] 7.1 Rework `apps/desktop/src/components/settings/tabs/models-settings.tsx`: drop the hardcoded `PROVIDER_CATALOG`; drive connected/managed state from `GET /api/auth`; keep the provider connect/disconnect flow via `POST/DELETE /api/auth/:provider`. Use the Hono RPC client (`hcWithType<App>`) instead of hand-rolled `fetch`.
- [~] 7.2 Add a minimal profiles UI (read `GET /api/profiles`, edit `defaultProfile` + the `default` model entry, write via `PUT /api/profiles`). Wire hybrid-vision fields to the profile's `hybrid` block so they persist (replacing the current local-only `hybridEnabled` signal and the disabled vision button).
- [~] 7.3 Update project settings surface to let a project pick a `profileId` (null → default) via the existing projects update route.

## 8. Docs and cleanup

- [x] 8.1 Update `AGENTS.md`: replace the "Model config lives in the DB" statement and the `/api/model-configs` + `/api/api-keys` route entries with the new `/api/profiles`, `/api/auth`, file-backed `/api/settings`, and `~/.sakti/agent/` layout; note `SAKTI_AGENT_DIR` env override and that per-session settings remain DB-backed.
- [x] 8.2 Remove the legacy `apps/server/src/lib/api-key-store.ts` and its tests once `auth-store.ts` is wired and green.
- [x] 8.3 Run `nub run typecheck`, `nub run test` (server + db + desktop), and `nubx ultracite fix`; resolve all failures before marking the change apply-ready.
