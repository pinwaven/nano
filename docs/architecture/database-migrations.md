# Database Migrations

## Overview

Schema changes are tracked via a `schema_migrations` table and applied by `scripts/migrate.js`. There are two separate databases:

| Environment | DB name | Connection var |
|---|---|---|
| Dev | `nano_db_dev` | `DATABASE_URL` in `.env` |
| Prod | `nano_db_prod` | `DATABASE_URL_PROD` in `.env` |

All migration SQL files live in two directories:

- `src/schemas/migration_*.sql` — permanent, versioned migrations
- `temp/migration_*.sql` — one-off or experimental migrations (also tracked)

Files are applied in alphabetical order by filename.

## Commands

```bash
# Check what is pending (no changes made)
npm run migrate:status        # dev
npm run migrate:status:prod   # prod

# Apply pending migrations
npm run migrate:dev
npm run migrate:prod

# First-time prod baseline (see below)
npm run migrate:baseline:prod
```

## Normal dev → prod workflow

1. Write your SQL change as `src/schemas/migration_<descriptive_name>.sql`
   - Always use `IF NOT EXISTS` / `IF EXISTS` / `ADD COLUMN IF NOT EXISTS` so the file is safe to re-run
2. Apply and test on dev: `npm run migrate:dev`
3. When ready for prod: `npm run migrate:prod`

## First-time prod setup (one-time, already done)

Before the migration runner existed, all SQL was applied manually. On the first run against a fresh prod DB, use `--baseline` to record all existing files as applied **without re-executing them**:

```bash
npm run migrate:baseline:prod
```

This creates the `schema_migrations` table and inserts one row per migration file. After this, `npm run migrate:prod` will only apply files added after the baseline.

## How it works

The runner (`scripts/migrate.js`):

1. Creates `schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ)` if it doesn't exist
2. Reads all `migration_*.sql` filenames from both dirs, sorts alphabetically
3. Skips any filename already recorded in `schema_migrations`
4. For each pending file: opens a transaction, runs the SQL, records the filename, commits — or rolls back and stops on failure

A failed migration stops the runner immediately so you never end up with partial state.

## Writing new migrations

- **Filename:** `migration_<snake_case_description>.sql` in `src/schemas/`
- **Idempotency:** Always guard with `IF NOT EXISTS` / `IF EXISTS` so a re-run is safe
- **Scope:** One logical change per file (e.g. one new table, one set of new columns)
- **No rollbacks:** There is no down-migration mechanism — design changes to be additive where possible

### Example

```sql
-- src/schemas/migration_add_foo_to_users.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS foo TEXT;
CREATE INDEX IF NOT EXISTS idx_users_foo ON users (foo);
```

## schema_migrations table

```sql
CREATE TABLE schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Query applied migrations on any DB:

```sql
SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at;
```
