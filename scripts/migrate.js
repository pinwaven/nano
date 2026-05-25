/**
 * Migration runner — tracks applied SQL files in schema_migrations table.
 *
 * Usage:
 *   node scripts/migrate.js             # run pending migrations against DATABASE_URL (dev)
 *   node scripts/migrate.js --env prod  # run pending migrations against DATABASE_URL_PROD
 *   node scripts/migrate.js --env test  # run pending migrations against DATABASE_URL_TEST (.env + .env.test)
 *   node scripts/migrate.js --baseline  # mark all files as applied WITHOUT running them (first-time prod setup)
 *   node scripts/migrate.js --env prod --baseline
 *   node scripts/migrate.js --status    # show applied vs pending (dry-run)
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

const MIGRATION_DIRS = [
    path.join(__dirname, '../src/schemas'),
    path.join(__dirname, '../temp'),
];

function resolveMigrationConfig(args = process.argv.slice(2), options = {}) {
    const env = options.env || process.env;
    const cwd = options.cwd || process.cwd();
    const dotenvConfig = options.dotenvConfig || dotenv.config;
    const envTarget = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'dev';

    dotenvConfig({ path: path.join(cwd, '.env') });
    if (envTarget === 'test') {
        // Test DB runs inherit shared settings from .env, then allow .env.test
        // to override DATABASE_URL_TEST and other test-only values.
        dotenvConfig({ path: path.join(cwd, '.env.test'), override: true });
    }

    const connectionEnvVar = {
        dev: 'DATABASE_URL',
        prod: 'DATABASE_URL_PROD',
        test: 'DATABASE_URL_TEST',
    }[envTarget];

    if (!connectionEnvVar) {
        throw new Error(`Unsupported env target: ${envTarget}`);
    }

    return {
        envTarget,
        isBaseline: args.includes('--baseline'),
        isStatus: args.includes('--status'),
        connectionEnvVar,
        connString: env[connectionEnvVar],
    };
}

function collectMigrationFiles() {
    const files = [];
    for (const dir of MIGRATION_DIRS) {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith('migration_') && f.endsWith('.sql')) {
                files.push({ name: f, fullPath: path.join(dir, f) });
            }
        }
    }
    // Sort alphabetically — consistent ordering across runs
    files.sort((a, b) => a.name.localeCompare(b.name));
    return files;
}

async function ensureTable(client) {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
}

async function getApplied(client) {
    const { rows } = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
    return new Set(rows.map(r => r.filename));
}

async function run(config = resolveMigrationConfig()) {
    const { envTarget, isBaseline, isStatus, connectionEnvVar, connString } = config;
    if (!connString) {
        console.error(`[migrate] ERROR: ${connectionEnvVar} is not set in ${envTarget === 'test' ? '.env or .env.test' : '.env'}`);
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: connString,
        ssl: false,
    });

    const client = await pool.connect();
    try {
        await ensureTable(client);
        const applied = await getApplied(client);
        const files = collectMigrationFiles();
        const pending = files.filter(f => !applied.has(f.name));

        console.log(`[migrate] target: ${envTarget.toUpperCase()}  applied: ${applied.size}  pending: ${pending.length}`);

        if (isStatus) {
            if (pending.length === 0) {
                console.log('[migrate] All migrations are up to date.');
            } else {
                console.log('[migrate] Pending migrations:');
                pending.forEach(f => console.log(`  - ${f.name}`));
            }
            return;
        }

        if (pending.length === 0) {
            console.log('[migrate] Nothing to do — all migrations already applied.');
            return;
        }

        for (const file of pending) {
            if (isBaseline) {
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                    [file.name]
                );
                console.log(`[migrate] baselined: ${file.name}`);
            } else {
                console.log(`[migrate] applying:  ${file.name}`);
                const sql = fs.readFileSync(file.fullPath, 'utf8');
                await client.query('BEGIN');
                try {
                    await client.query(sql);
                    await client.query(
                        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
                        [file.name]
                    );
                    await client.query('COMMIT');
                    console.log(`[migrate] applied:   ${file.name}`);
                } catch (err) {
                    await client.query('ROLLBACK');
                    console.error(`[migrate] FAILED:    ${file.name} — ${err.message}`);
                    process.exitCode = 1;
                    return;
                }
            }
        }

        console.log(`[migrate] Done. ${isBaseline ? 'Baselined' : 'Applied'} ${pending.length} migration(s).`);
    } finally {
        client.release();
        await pool.end();
    }
}

if (require.main === module) {
    run().catch(err => {
        console.error('[migrate] Unexpected error:', err.message);
        process.exitCode = 1;
    });
}

module.exports = {
    resolveMigrationConfig,
    collectMigrationFiles,
    run,
};
