# OpenCode to EkaCode Parity Mapping

## Purpose

This document maps OpenCode provider/model integration modules to EkaCode implementation targets for the multi-provider parity rollout.

## Module Mapping

| OpenCode Source                                            | Responsibility                                              | EkaCode Target                                                                                | Status                 | Notes                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| `opencode/packages/opencode/src/provider/provider.ts`      | Provider registry, provider descriptors, provider lifecycle | `packages/server/src/provider/registry.ts` + `packages/server/src/provider/adapters/*`        | Planned                | Preserve `@ekacode/zai` as first-class adapter.         |
| `opencode/packages/opencode/src/provider/models.ts`        | Model catalog assembly, defaults, provider model discovery  | `packages/server/src/provider/models/catalog.ts`                                              | Planned                | Use models.dev live source + cache + snapshot fallback. |
| `opencode/packages/opencode/src/provider/transform.ts`     | Normalize provider model payloads for UI/runtime            | `packages/server/src/provider/transform.ts` (or in catalog service)                           | Planned                | Keep normalized capability flags in API payload.        |
| `opencode/packages/opencode/src/provider/auth.ts`          | Auth state, token/OAuth flows                               | `packages/server/src/provider/auth/service.ts` + `packages/server/src/provider/auth/oauth.ts` | Planned                | Persist tokens with unstorage `fs-lite`.                |
| `opencode/packages/opencode/src/provider/error.ts`         | Provider/auth error normalization                           | `packages/server/src/provider/errors.ts`                                                      | Planned                | Emit stable error codes to desktop API client.          |
| `opencode/packages/opencode/src/server/routes/provider.ts` | Provider endpoints (list/models/auth)                       | `packages/server/src/routes/provider.ts`                                                      | Placeholder -> Planned | Replace current placeholder route responses.            |
| `opencode/packages/opencode/src/server/routes/config.ts`   | Config endpoint composition with providers/models           | `packages/server/src/routes/config.ts` or `packages/server/src/routes/provider.openapi.ts`    | Planned                | Include generated JSON schema/OpenAPI payloads.         |
| `opencode/packages/app/src/lib/client.ts`                  | Desktop app API client calls                                | `apps/desktop/src/core/services/api/provider-client.ts`                                       | Planned                | Typed API wrapper around provider endpoints.            |
| `opencode/packages/app/src/routes/settings/provider.tsx`   | Provider settings/login UX                                  | `apps/desktop/src/views/components/provider-settings.tsx`                                     | Planned                | Include token and OAuth flows.                          |
| `opencode/packages/app/src/routes/new/index.tsx`           | New chat provider/model selection defaults                  | `apps/desktop/src/views/components/model-selector.tsx` + store                                | Planned                | Persist selected provider/model preferences.            |

## Intentional Deviations

- Credential backend uses `unstorage` with `fs-lite` driver rather than OpenCode's exact persistence internals.
- Existing EkaCode `packages/zai` provider remains default-compatible during migration.
- JSON schema artifacts are committed and drift-tested in EkaCode CI.

## Alignment Checkpoints

- Re-verify mapping at each phase gate in `docs/plans/2026-02-14-opencode-multi-provider-parity-implementation.md`.
- If upstream OpenCode provider route/model payloads change, update this file before changing implementation.
