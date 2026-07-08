## 1. Auth store rewrite (`apps/server/src/lib/auth-store.ts`)

- [x] 1.1 Add `import { getProviders, type KnownProvider } from "@earendil-works/pi-ai"` at the top of `auth-store.ts`. Cache `getProviders()` in a module-level `const KNOWN_PROVIDERS = getProviders()` so the catalog is read once per process (it is static).
- [x] 1.2 Delete the `PROVIDER_ENV_MAP` constant (lines ~16-31), the `KNOWN_PROVIDERS` array literal (lines ~34-43), and the `PROVIDER_ENV_VARS` re-export (line ~45). Keep the `AuthEntry` interface but drop its `envVar` field — new shape `{ provider: string; hasKey: boolean; maskedKey: string | null }`.
- [x] 1.3 Add `getApiKey(provider: string): string | undefined` to the `AuthStore` interface and implement it on the returned object: under the existing `withLock`, read `auth.json`, return `current[provider]` (or `undefined`). This is a read-only locked op — no `next`.
- [x] 1.4 Rewrite `list()`: replace `for (const provider of KNOWN_PROVIDERS)` (the old hand-rolled array) with iteration over the new cached `KNOWN_PROVIDERS` constant from `getProviders()`. Drop the `envVar` lookup; each entry becomes `{ provider, hasKey: !!key, maskedKey: key ? \`...${key.slice(-4)}\` : null }`.
- [x] 1.5 Rewrite `set(provider, key)`: replace `const envVar = PROVIDER_ENV_MAP[provider]; if (!envVar) return false` with `if (!KNOWN_PROVIDERS.includes(provider as KnownProvider)) return false`. Remove the `process.env[envVar] = trimmed` write. Keep the file write + 0o600 chmod under the lock.
- [x] 1.6 Rewrite `delete(provider)`: replace `const envVar = PROVIDER_ENV_MAP[provider]; if (!envVar) return false` with `if (!KNOWN_PROVIDERS.includes(provider as KnownProvider)) return false`. Remove the `delete process.env[envVar]` line. Keep the file mutation under the lock.
- [x] 1.7 Delete `loadIntoEnv()` from the interface and the implementation.
- [x] 1.8 Update the file's top doc-comment: remove the line claiming it "Mirrors pi-ai's env-api-keys.ts mapping so keys loaded into process.env are found by getEnvApiKey()". Replace with a one-line note that auth.json is the single source of truth.

## 2. Wire `resolveAuth` to the auth store (`apps/server/src/agent/model-resolver.ts`)

- [x] 2.1 Update the import line: `import { getEnvApiKey, getModel } from "@earendil-works/pi-ai"` → `import { getModel } from "@earendil-works/pi-ai"`.
- [x] 2.2 In `resolveAuth`, change `const apiKey = getEnvApiKey(resolved.provider)` to `const apiKey = ctx.auth.getApiKey(resolved.provider)`.

## 3. Drop `loadIntoEnv()` from server startup (`apps/server/src/create-server.ts`)

- [x] 3.1 Delete line 114: `auth.loadIntoEnv();`. Confirm nothing else in `create-server.ts` references the auth store writing to env.

## 4. UI: drop unused `envVar` field (`apps/desktop/src/components/settings/tabs/models-settings.tsx`)

- [x] 4.1 In the `ApiKeyInfo` interface (lines 20-25), delete the `envVar: string` field. The `fetchApiKeys` function's `as ApiKeyInfo[]` cast will still work because the server response no longer includes `envVar` either.
- [x] 4.2 Confirm via grep that no other UI code reads `ApiKeyInfo.envVar` or `.envVar` from auth responses. If found, update or remove.

## 5. Tests — auth store (`apps/server/src/lib/__tests__/auth-store.test.ts`)

- [x] 5.1 Delete the `"list returns masked entries for all known providers when empty"` test's reliance on `entry.envVar` (line 39 assertion `expect(entry.envVar).toBeTruthy()` — remove that line).
- [x] 5.2 Delete the `"loadIntoEnv reads file and sets env vars"` test entirely (lines ~78-86).
- [x] 5.3 Replace the `"set writes to process.env"` test (lines ~66-70) with `"getApiKey returns the stored key"`: `store.set("openai", "sk-test"); expect(store.getApiKey("openai")).toBe("sk-test")`.
- [x] 5.4 Replace the `"delete clears process.env"` test (lines ~72-76) with `"getApiKey returns undefined after delete"`: `store.set("openai", "sk-test"); store.delete("openai"); expect(store.getApiKey("openai")).toBeUndefined()`.
- [x] 5.5 Add a new test: `"getApiKey returns undefined for a provider with no stored key"` — fresh store, `expect(store.getApiKey("openai")).toBeUndefined()`.
- [x] 5.6 Add a regression test for the original bug: `"set then list round-trips for a provider not in the old hardcoded list"` — `store.set("zai", "sk-zai-test-1234567890"); const zai = store.list().find(e => e.provider === "zai"); expect(zai?.hasKey).toBe(true); expect(zai?.maskedKey).toBe("...7890")`.
- [x] 5.7 Verify the existing `"unknown provider is rejected"` test (line ~88) still passes — it should, because `set("bogus", ...)` now rejects via `!KNOWN_PROVIDERS.includes("bogus")`.

## 6. Tests — model resolver (`apps/server/src/agent/__tests__/model-resolver.test.ts`)

- [x] 6.1 Read the existing model-resolver tests. Find every test that sets `process.env.OPENAI_API_KEY = "test-key"` (or similar) to make `getEnvApiKey` return. Replace each with `ctx.auth.set("openai", "test-key")` before calling `resolveAuth`.
- [x] 6.2 Update any test assertion that relied on `getEnvApiKey` returning a value when only `process.env` was set (no `auth.set`) — these now expect `resolveAuth` to return `undefined`. Convert the test to call `ctx.auth.set` to keep the original intent, OR assert the new "ignores env" behavior explicitly.
- [x] 6.3 Confirm the "no API key" error path test still passes (resolveAuth returns undefined → runner throws).

## 7. Tests — server integration (`apps/server/src/__tests__/`)

- [x] 7.1 Audit `apps/server/src/__tests__/compaction.test.ts` for `process.env.OPENAI_API_KEY` usage. The line 129 comment references `getEnvApiKey`; update it to reference `ctx.auth.getApiKey`. If the test seeds the key via env, switch to `ctx.auth.set`.
- [x] 7.2 Audit `apps/server/src/__tests__/auth.test.ts` (route tests). The masked-response assertions (lines 11, 35, 39, 65, 68) reference `envVar` in the typed shape — drop those field checks. Confirm the route still returns 200 with `{ provider, hasKey, maskedKey }`.
- [x] 7.3 Audit `apps/server/src/__tests__/helpers.ts` — no change needed (it constructs the auth store via `createAuthStore(...)` which still works).
- [x] 7.4 Audit `apps/server/src/__tests__/llm-helpers.ts` — it sets `process.env.OPENAI_API_KEY` for the faux provider registration. Confirm this is for pi-ai's internal faux-provider lookup (NOT for `resolveAuth`) and leave it intact. If a test uses both faux provider AND `resolveAuth`, ensure `ctx.auth.set` is also called.

## 8. Desktop UI tests (`apps/desktop/src/components/settings/tabs/__tests__/models-settings.test.tsx`)

- [x] 8.1 The existing `authEntries` helper builds response objects with an `envVar` field. Drop `envVar` from the helper's output to match the new server response shape. Verify all 6 tests still pass.

## 9. Verification

- [x] 9.1 Run `nub run typecheck` from repo root. Fix any TS errors (likely: places that destructured `envVar` from the auth response, or `getEnvApiKey` imports that are now unused).
- [x] 9.2 Run `nubx ultracite fix` to apply formatting + lint.
- [x] 9.3 Run `cd apps/server && nub run test`. All auth-store, model-resolver, route, and compaction tests must pass.
- [x] 9.4 Run `cd apps/desktop && nub run test`. The models-settings tests must pass.
- [x] 9.5 Run `cd packages/agent && nub run test`. Confirm no agent-package regression (the agent package does not call `getEnvApiKey`, but sanity-check).
- [ ] 9.6 Manual smoke check (optional): start the desktop app, connect a `zai` provider key through the settings UI, confirm the UI now shows it as Connected, run a prompt, confirm the harness receives the key (no "No API key for zai" error).
