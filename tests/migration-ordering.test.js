// Ordering guarantees for scripts/migrate.js.
//
// Migration filenames are descriptive rather than numbered, so alphabetical order encodes no
// dependency information. A prod run on 2026-08-27 died on `relation "viva_ag_jobs" does not
// exist` because migration_viva_ag_formulations.sql sorts ahead of the migration that creates
// the table its FK points at. These pin down the `-- @requires:` mechanism that fixes it, plus
// the real declarations in src/schemas.
const assert = require('node:assert');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { parseRequires, orderMigrations } = require(path.join(__dirname, '..', 'scripts', 'migration-order.js'));

const alphabetical = names => names
    .slice()
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map(name => ({ name, requires: [] }));

const orderOf = files => orderMigrations(files).map(f => f.name);

// ── parseRequires ───────────────────────────────────────────────────────────

test('a single declaration is picked up', () => {
  assert.deepStrictEqual(parseRequires('-- @requires: migration_a.sql\nALTER TABLE x;'), ['migration_a.sql']);
});

test('comma-separated and repeated declarations both accumulate, without duplicates', () => {
  const sql = '-- @requires: migration_a.sql, migration_b.sql\n-- @requires: migration_a.sql, migration_c.sql\n';
  assert.deepStrictEqual(parseRequires(sql), ['migration_a.sql', 'migration_b.sql', 'migration_c.sql']);
});

test('a file with no declaration yields none', () => {
  assert.deepStrictEqual(parseRequires('CREATE TABLE foo (id INT);'), []);
});

// ── orderMigrations ─────────────────────────────────────────────────────────

test('files that declare nothing keep their alphabetical order', () => {
  const files = alphabetical(['migration_c.sql', 'migration_a.sql', 'migration_b.sql']);
  assert.deepStrictEqual(orderOf(files), ['migration_a.sql', 'migration_b.sql', 'migration_c.sql']);
});

test('a declared prerequisite is applied first even when it sorts later', () => {
  // The exact shape of the prod failure: "formulations" < "jobs" alphabetically.
  const files = [
    { name: 'migration_viva_ag_formulations.sql', requires: ['migration_viva_ag_jobs.sql'] },
    { name: 'migration_viva_ag_jobs.sql', requires: [] },
  ];
  assert.deepStrictEqual(orderOf(files), ['migration_viva_ag_jobs.sql', 'migration_viva_ag_formulations.sql']);
});

test('reordering is local — unrelated files are not dragged along', () => {
  const files = [
    { name: 'migration_a.sql', requires: [] },
    { name: 'migration_m_needs_z.sql', requires: ['migration_z.sql'] },
    { name: 'migration_n.sql', requires: [] },
    { name: 'migration_z.sql', requires: [] },
  ];
  assert.deepStrictEqual(orderOf(files), [
    'migration_a.sql',
    'migration_z.sql',
    'migration_m_needs_z.sql',
    'migration_n.sql',
  ]);
});

test('a transitive chain resolves in full', () => {
  const files = [
    { name: 'migration_a.sql', requires: ['migration_b.sql'] },
    { name: 'migration_b.sql', requires: ['migration_c.sql'] },
    { name: 'migration_c.sql', requires: [] },
  ];
  assert.deepStrictEqual(orderOf(files), ['migration_c.sql', 'migration_b.sql', 'migration_a.sql']);
});

test('a prerequisite that does not exist aborts the run', () => {
  const files = [{ name: 'migration_a.sql', requires: ['migration_typo.sql'] }];
  assert.throws(() => orderMigrations(files), /migration_typo\.sql/);
});

test('a dependency cycle aborts the run rather than silently degrading', () => {
  const files = [
    { name: 'migration_a.sql', requires: ['migration_b.sql'] },
    { name: 'migration_b.sql', requires: ['migration_a.sql'] },
  ];
  assert.throws(() => orderMigrations(files), /circular/i);
});

// ── the real migration set ──────────────────────────────────────────────────

const MIGRATION_DIRS = [
    path.join(__dirname, '..', 'src', 'schemas'),
    path.join(__dirname, '..', 'temp'),
];

function realMigrations() {
    const files = [];
    for (const dir of MIGRATION_DIRS) {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
            if (f.startsWith('migration_') && f.endsWith('.sql')) {
                files.push({ name: f, requires: parseRequires(fs.readFileSync(path.join(dir, f), 'utf8')) });
            }
        }
    }
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return files;
}

test('every @requires in the repo names a migration that exists, with no cycles', () => {
  assert.doesNotThrow(() => orderMigrations(realMigrations()));
});

test('every declared prerequisite really is applied before its dependent', () => {
  const files = realMigrations();
  const position = new Map(orderMigrations(files).map((f, i) => [f.name, i]));
  for (const file of files) {
    for (const dep of file.requires) {
      assert.ok(
        position.get(dep) < position.get(file.name),
        `${dep} must be applied before ${file.name}`
      );
    }
  }
});

test('viva_ag_jobs is applied before the three migrations that build on it', () => {
  const order = orderMigrations(realMigrations()).map(f => f.name);
  const jobs = order.indexOf('migration_viva_ag_jobs.sql');
  assert.ok(jobs >= 0, 'migration_viva_ag_jobs.sql should exist');
  for (const dependent of [
    'migration_viva_ag_formulations.sql',
    'migration_viva_ag_questionnaire.sql',
    'migration_viva_ag_result_files.sql',
  ]) {
    const at = order.indexOf(dependent);
    assert.ok(at >= 0, `${dependent} should exist`);
    assert.ok(at > jobs, `${dependent} must come after migration_viva_ag_jobs.sql`);
  }
});
