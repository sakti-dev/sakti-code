# Database Migrations

This repo uses Drizzle migrations under `packages/server/drizzle`.

## Generate a migration

```bash
pnpm --filter @sakti-code/server drizzle:generate
```

## Verify migration state

Run both checks:

```bash
pnpm --filter @sakti-code/server drizzle:check
node scripts/check-server-migration-policy.mjs
```

Or run the combined command:

```bash
pnpm migrations:check:server
```

## Policy (strict append-only)

Allowed changes in `packages/server/drizzle`:

- Add new migration SQL file: `A packages/server/drizzle/<new-tag>.sql`
- Add new snapshot file: `A packages/server/drizzle/meta/<new-index>_snapshot.json`
- Update journal: `M packages/server/drizzle/meta/_journal.json`

Disallowed changes:

- Deleting historical migration SQL or snapshot files
- Renaming historical migration files
- Modifying historical migration SQL or snapshot files

## Runtime migration source

Migration folder resolution uses this order:

1. `SAKTI_CODE_MIGRATIONS_DIR` (explicit override)
2. Bundled migration paths near server build output
3. Development source path (`packages/server/drizzle`)

If no valid `meta/_journal.json` is found, startup fails fast with an error.
