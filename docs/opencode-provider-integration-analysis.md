# OpenCode Multi-Provider Integration Analysis

## Scope

This document explains how OpenCode supports many providers and model families, with emphasis on:

- OpenCode Zen (`opencode` provider)
- Kimi models
- Z.AI and Z.AI Coding Plan
- ZenMux
- How the desktop app consumes provider/model data

---

## Executive Summary

OpenCode's broad provider/model support is not from one mechanism alone. It is a layered architecture:

1. `models.dev` provides the provider/model catalog and metadata.
2. OpenCode builds a runtime provider registry by merging:
   - catalog data
   - config overrides
   - env credentials
   - stored auth credentials
   - plugin auth loaders
3. AI SDK adapters (bundled or dynamic) execute requests.
4. `ProviderTransform` normalizes provider-specific differences (messages, options, schemas, reasoning variants).
5. Desktop/web UI consumes server APIs (`/provider`, `/config/providers`) and renders provider/model selectors.

---

## 1) `models.dev` as the Metadata Backbone

### Build-time snapshot

OpenCode's build script fetches `api.json` from `models.dev` and generates a bundled snapshot:

- `opencode/packages/opencode/script/build.ts:17`
- output: `src/provider/models-snapshot.ts`

### Runtime load order

At runtime, data is loaded in this order:

1. cache file (or `OPENCODE_MODELS_PATH`)
2. bundled snapshot
3. live fetch from `models.dev` (if not disabled)

Code:

- `opencode/packages/opencode/src/provider/models.ts:87`
- `opencode/packages/opencode/src/provider/models.ts:96`

### Refresh behavior

- Startup refresh + hourly background refresh:
  - `opencode/packages/opencode/src/provider/models.ts:125`
- Manual refresh:
  - `opencode models --refresh`
  - `opencode/packages/opencode/src/cli/cmd/models.ts:23`

### Relevant flags

- `OPENCODE_MODELS_URL`
- `OPENCODE_MODELS_PATH`
- `OPENCODE_DISABLE_MODELS_FETCH`

Code:

- `opencode/packages/opencode/src/flag/flag.ts:20`
- `opencode/packages/opencode/src/flag/flag.ts:54`

---

## 2) Runtime Provider Registry Construction

Provider/model objects are synthesized from `models.dev` and then merged with local state.

Key pipeline:

- convert models.dev model -> internal model: `opencode/packages/opencode/src/provider/provider.ts:626`
- convert models.dev provider -> internal provider: `opencode/packages/opencode/src/provider/provider.ts:693`
- build state and merge sources: `opencode/packages/opencode/src/provider/provider.ts:704`

Merge inputs include:

- `opencode.json` provider/model overrides: `opencode/packages/opencode/src/provider/provider.ts:757`
- env-based credentials: `opencode/packages/opencode/src/provider/provider.ts:840`
- stored auth credentials: `opencode/packages/opencode/src/provider/provider.ts:852`
- plugin-auth-enriched providers: `opencode/packages/opencode/src/provider/provider.ts:863`
- custom provider loaders (`CUSTOM_LOADERS`): `opencode/packages/opencode/src/provider/provider.ts:910`

Filtering and cleanup:

- `enabled_providers` / `disabled_providers`: `opencode/packages/opencode/src/provider/provider.ts:710`
- remove alpha unless experimental enabled, remove deprecated, apply blacklist/whitelist:
  - `opencode/packages/opencode/src/provider/provider.ts:943`

---

## 3) Why This Scales to "Many Providers"

### A) Adapter abstraction via AI SDK

Bundled adapters for many providers (OpenAI, Anthropic, Google, Bedrock, OpenRouter, xAI, etc.) are mapped in one table:

- `opencode/packages/opencode/src/provider/provider.ts:60`

If adapter not bundled, OpenCode can install/import dynamically:

- `opencode/packages/opencode/src/provider/provider.ts:1066`

### B) Minimal per-provider loader hooks

`CUSTOM_LOADERS` inject provider-specific behavior (auth detection, model loading mode, headers, etc.):

- `opencode/packages/opencode/src/provider/provider.ts:92`

Examples:

- `opencode` logic for free-only fallback without key: `opencode/packages/opencode/src/provider/provider.ts:104`
- Bedrock region/profile/prefix behavior: `opencode/packages/opencode/src/provider/provider.ts:184`
- OpenRouter/Vercel header presets: `opencode/packages/opencode/src/provider/provider.ts:334`
- ZenMux header presets: `opencode/packages/opencode/src/provider/provider.ts:414`

### C) Central provider-difference normalization

`ProviderTransform` handles cross-provider differences once, instead of scattering logic:

- message normalization: `opencode/packages/opencode/src/provider/transform.ts:47`
- provider options key remap: `opencode/packages/opencode/src/provider/transform.ts:266`
- reasoning variants by provider/model: `opencode/packages/opencode/src/provider/transform.ts:331`
- request option defaults (reasoning/cache/thinking): `opencode/packages/opencode/src/provider/transform.ts:617`
- schema sanitization (notably Gemini): `opencode/packages/opencode/src/provider/transform.ts:765`

This transform layer is used in execution path:

- LLM stream setup: `opencode/packages/opencode/src/session/llm.ts:102`
- prompt message transform before send: `opencode/packages/opencode/src/session/llm.ts:245`
- tool schema transform: `opencode/packages/opencode/src/session/prompt.ts:783`

---

## 4) Focused Analysis: Zen, Kimi, Z.AI, Z.AI Coding Plan, ZenMux

## 4.1 OpenCode Zen (`opencode` provider)

Zen is integrated as a regular provider in the same provider pipeline.

- Auth/connect flow uses provider list from models.dev and stored credentials.
- If no key is present for `opencode`, loader removes paid models and keeps free ones:
  - `opencode/packages/opencode/src/provider/provider.ts:104`
- If key is present, full model catalog is available.

Docs describe Zen as a gateway with curated model/provider combinations:

- `opencode/packages/web/src/content/docs/zen.mdx:44`
- model ID format: `opencode/<model-id>`:
  - `opencode/packages/web/src/content/docs/zen.mdx:96`

## 4.2 Kimi models

Kimi is handled primarily as model-level behavior, not as a separate engine path.

- Kimi appears in provider catalogs (Zen and others) as model IDs.
- Transform layer applies Kimi-specific defaults/tuning:
  - temperature/topP handling: `opencode/packages/opencode/src/provider/transform.ts:299`
  - reasoning-thought defaults for k2.5 variants: `opencode/packages/opencode/src/provider/transform.ts:669`
- Special cases reference `kimi-k2-thinking` and `kimi-k2.5` variants across provider IDs.

## 4.3 Z.AI and Z.AI Coding Plan

Docs show user-facing flow:

- Z.AI section: `opencode/packages/web/src/content/docs/providers.mdx:1707`
- If subscribed to GLM Coding Plan, select Z.AI Coding Plan:
  - `opencode/packages/web/src/content/docs/providers.mdx:1717`

Implementation interpretation:

- `/connect` provider choices come from filtered `models.dev` provider IDs:
  - `opencode/packages/opencode/src/cli/cmd/auth.ts:241`
- Runtime has explicit transform handling for `zai` and `zhipuai` provider IDs:
  - `opencode/packages/opencode/src/provider/transform.ts:649`
- Provider error handling notes z.ai-specific overflow caveat:
  - `opencode/packages/opencode/src/provider/error.ts:32`

Inference from code+docs:

- "Z.AI Coding Plan" is likely represented as a distinct provider profile/ID from catalog (not a separate architecture path), then handled by the same provider pipeline + transform system.

## 4.4 ZenMux

ZenMux is also a normal provider entry plus a small custom loader:

- loader with preset headers: `opencode/packages/opencode/src/provider/provider.ts:414`
- docs section: `opencode/packages/web/src/content/docs/providers.mdx:1736`

---

## 5) Auth and Provider Onboarding

### `/connect` / `auth login` behavior

- Provider picker is built from `ModelsDev.get()` plus config filters:
  - `opencode/packages/opencode/src/cli/cmd/auth.ts:241`
- Plugin-auth providers (OAuth/API with prompts) are supported via plugin hooks:
  - `opencode/packages/opencode/src/cli/cmd/auth.ts:18`
  - `opencode/packages/opencode/src/provider/auth.ts:30`

### Plugin system contribution

Built-in/internal plugins include Codex, Copilot, GitLab auth integrations:

- `opencode/packages/opencode/src/plugin/index.ts:22`

This mechanism allows provider-specific auth UX without changing core provider architecture.

---

## 6) Desktop App Integration Path

The desktop app (`@opencode-ai/app`) consumes server APIs and does not implement provider logic itself.

### Server wiring

Routes mounted under OpenCode server include:

- `/provider`: `opencode/packages/opencode/src/server/server.ts:234`
- `/config/providers`: `opencode/packages/opencode/src/server/server.ts:229`

### API semantics

- `/provider` returns:
  - `all` providers (catalog + connected)
  - `default` model per provider
  - `connected` provider IDs

Code:

- `opencode/packages/opencode/src/server/routes/provider.ts:15`
- `opencode/packages/opencode/src/server/routes/provider.ts:50`

- `/config/providers` returns connected/configured provider info:
  - `opencode/packages/opencode/src/server/routes/config.ts:62`

### UI bootstrap and usage

Global bootstrap fetches provider list/auth methods:

- `opencode/packages/app/src/context/global-sync/bootstrap.ts:71`

Provider state consumption:

- `useProviders`: `opencode/packages/app/src/hooks/use-providers.ts:9`
- provider select dialog: `opencode/packages/app/src/components/dialog-select-provider.tsx:20`
- model select dialog: `opencode/packages/app/src/components/dialog-select-model.tsx:21`
- connect/auth dialog: `opencode/packages/app/src/components/dialog-connect-provider.tsx:23`

Model visibility/recent/latest logic in UI:

- `opencode/packages/app/src/context/models.tsx:39`

### Server connection from app

App initializes server URL and SDK providers:

- `opencode/packages/app/src/app.tsx:166`
- global sdk/event stream: `opencode/packages/app/src/context/global-sdk.tsx:8`
- directory-scoped sdk: `opencode/packages/app/src/context/sdk.tsx:12`

---

## 7) Additional Observations

1. Provider icons in UI are also derived from models.dev (provider IDs + logos):
   - `opencode/packages/ui/vite.config.ts:47`

2. Config schema model IDs are annotated with models.dev schema reference:
   - `opencode/packages/opencode/src/config/config.ts:36`

3. Docs explicitly state standard providers pull limits from models.dev automatically:
   - `opencode/packages/web/src/content/docs/providers.mdx:1904`

---

## 8) Answer to the Core Question

Yes, `models.dev` is a major reason OpenCode can support many providers/models quickly.

But the full reason is the combination of:

- catalog standardization (`models.dev`)
- adapter abstraction (AI SDK)
- OpenCode registry merge pipeline
- provider/model transform layer (`ProviderTransform`)
- plugin-based auth and provider UX
- desktop app consuming normalized provider APIs

This is why OpenCode can expose providers like Zen, Z.AI, ZenMux and model families like Kimi without creating a custom architecture for each one.
