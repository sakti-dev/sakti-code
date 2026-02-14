# Multi-Provider Integration

This repo supports OpenCode-style multi-provider model routing in the server and desktop app.

## Server Endpoints

- `GET /api/providers`
- `GET /api/providers/auth`
- `GET /api/providers/models`
- `POST /api/providers/:providerId/auth/token`
- `DELETE /api/providers/:providerId/auth/token`
- `POST /api/providers/:providerId/oauth/authorize`
- `POST /api/providers/:providerId/oauth/callback`

## Desktop Integration

- Typed client: `apps/desktop/src/core/services/api/provider-client.ts`
- Settings UI: `apps/desktop/src/views/components/provider-settings.tsx`
- Model selector: `apps/desktop/src/views/components/model-selector.tsx`

## OpenCode Alignment

- Reference mapping: `docs/plans/opencode-parity-mapping.md`
- Implementation plan: `docs/plans/2026-02-14-opencode-multi-provider-parity-implementation.md`
