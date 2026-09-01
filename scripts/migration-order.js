/**
 * Dependency-aware ordering for migration files.
 *
 * Filenames here are descriptive, not numbered, so alphabetical order carries no information
 * about which migration depends on which. That is fine right up until two related files sort
 * the wrong way round: migration_viva_ag_formulations.sql (a CREATE TABLE with an FK to
 * viva_ag_jobs) sorts ahead of migration_viva_ag_jobs.sql (which creates that table), so a
 * prod run died on `relation "viva_ag_jobs" does not exist`. Dev never noticed, because there
 * the two files were applied chronologically across separate runs.
 *
 * The fix is to let a migration state its own prerequisites instead of encoding them in a name:
 *
 *     -- @requires: migration_viva_ag_jobs.sql
 *
 * One filename per directive, or several comma-separated; repeat the line as needed. Anything
 * declared is applied first. Independent migrations keep their existing alphabetical order, so
 * the vast majority of files — which declare nothing — are ordered exactly as before.
 *
 * Both failure modes are loud: a typo'd filename and a dependency cycle each abort the run
 * rather than silently degrading to alphabetical order, which is the behaviour that caused the
 * original bug.
 */

// Deliberately matches anywhere in the file, not just a leading header block: the directive
// reads most naturally right above the statement that needs the dependency.
const REQUIRES_RE = /^[ \t]*--[ \t]*@requires:[ \t]*(.+?)[ \t]*$/gm;

/**
 * Extract declared prerequisites from a migration's SQL text.
 * @param {string} sql
 * @returns {string[]} filenames, in declaration order, duplicates removed
 */
function parseRequires(sql) {
    const found = [];
    for (const match of String(sql).matchAll(REQUIRES_RE)) {
        for (const part of match[1].split(',')) {
            const name = part.trim();
            if (name && !found.includes(name)) found.push(name);
        }
    }
    return found;
}

/**
 * Stable topological sort: prerequisites first, alphabetical order preserved among files that
 * do not depend on each other.
 *
 * @param {Array<{name: string, requires?: string[]}>} files - already sorted alphabetically
 * @returns {Array} the same file objects, reordered
 * @throws if a declared prerequisite does not exist, or the declarations form a cycle
 */
function orderMigrations(files) {
    const byName = new Map(files.map(f => [f.name, f]));

    for (const file of files) {
        for (const dep of file.requires || []) {
            if (!byName.has(dep)) {
                throw new Error(
                    `${file.name} declares "@requires: ${dep}", but no migration by that name exists ` +
                    `(expected a filename such as migration_foo.sql)`
                );
            }
        }
    }

    const ordered = [];
    const state = new Map(); // name -> 'visiting' | 'done'

    const visit = (file, trail) => {
        const seen = state.get(file.name);
        if (seen === 'done') return;
        if (seen === 'visiting') {
            throw new Error(`circular @requires: ${[...trail, file.name].join(' -> ')}`);
        }
        state.set(file.name, 'visiting');
        for (const dep of file.requires || []) {
            visit(byName.get(dep), [...trail, file.name]);
        }
        state.set(file.name, 'done');
        ordered.push(file);
    };

    // Visiting in the incoming (alphabetical) order is what makes the result stable.
    for (const file of files) visit(file, []);
    return ordered;
}

module.exports = { parseRequires, orderMigrations };
