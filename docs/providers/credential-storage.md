# Provider Credential Storage

Provider credentials are persisted on the server using `unstorage` with the `fs-lite` driver.

## Storage Backend

- Library: `unstorage`
- Driver: `unstorage/drivers/fs-lite`
- Server module: `packages/server/src/provider/storage.ts`

## Storage Path

Credentials are stored under:

- `${EKACODE_HOME}/state/provider-credentials`

The runtime path is created in:

- `packages/server/src/provider/runtime.ts`

## Key Structure

Storage keys are namespaced by profile and provider:

- `profiles/<profileId>/providers/<providerId>`

Current profile default:

- `default`

## Stored Record

```json
{
  "providerId": "zai",
  "profileId": "default",
  "kind": "token",
  "secret": "...",
  "updatedAt": "2026-02-14T11:00:00.000Z"
}
```

## Security Notes

- Auth state APIs return redacted state only (no secret/token field).
- Credentials are persisted server-side only.
- Desktop stores selected provider/model preference only (not provider secrets).
