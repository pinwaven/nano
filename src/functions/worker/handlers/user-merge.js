'use strict';

// Same-system duplicate-account merge, triggered whenever a user's identity fields
// (government_id, first_name/last_name, birth_date) are set — see handleSetIdentity.
// See migration_users_merge.sql for schema, docs/architecture (plan doc) for the
// design this implements.
const { pool } = require('../lib/db');

function normalizeIdentity(str) {
    if (str == null) return null;
    // NFKC folds full-width CJK punctuation/Latin/digits to their standard forms, so
    // e.g. "Ｚｈａｎｇ" (full-width input, common from some IME/keyboard configs) and
    // "Zhang" normalize identically.
    return String(str).normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
}

function quoteIdent(ident) {
    return `"${String(ident).replace(/"/g, '""')}"`;
}

// A merge keeps the older user_id, but the newer row can carry access that was assigned
// deliberately after the original account was created (for example, promotion into a child
// channel plus coach/admin roles). Keep every role and prefer the loser's channel only when it
// is more specific than the winner's channel. Sibling/root changes remain on the winner because
// there is no safe way to infer which organization should own the merged account.
function reconcileAccessContextValues(winner, loser, loserLineage = []) {
    const roles = [...new Set([...(winner.roles || []), ...(loser.roles || [])])];
    const winnerChannel = winner.channel_id;
    const loserChannel = loser.channel_id;
    const loserAncestorIds = new Set(loserLineage.map(String));
    const channelId = winnerChannel == null
        ? loserChannel
        : (loserChannel != null && loserAncestorIds.has(String(winnerChannel)) ? loserChannel : winnerChannel);
    return { roles, channelId };
}

async function reconcileAccessContext(client, winnerId, loserId) {
    const { rows } = await client.query(
        'SELECT user_id, roles, channel_id FROM users WHERE user_id = ANY($1::text[])',
        [[winnerId, loserId]]
    );
    const winner = rows.find(row => row.user_id === winnerId);
    const loser = rows.find(row => row.user_id === loserId);
    if (!winner || !loser) throw new Error('merge_user_not_found');

    let loserLineage = [];
    if (loser.channel_id != null) {
        const lineage = await client.query(
            `WITH RECURSIVE lineage AS (
                 SELECT id, parent_channel_id FROM channels WHERE id = $1
                 UNION ALL
                 SELECT c.id, c.parent_channel_id
                   FROM channels c JOIN lineage l ON c.id = l.parent_channel_id
             )
             SELECT id FROM lineage`,
            [loser.channel_id]
        );
        loserLineage = lineage.rows.map(row => row.id);
    }

    const access = reconcileAccessContextValues(winner, loser, loserLineage);
    await client.query(
        'UPDATE users SET roles = $1::text[], channel_id = $2, updated_at = NOW() WHERE user_id = $3',
        [access.roles, access.channelId, winnerId]
    );
}

// Moving the loser's phones starts by demoting them so two primary rows cannot collide on the
// winner. When the winner had no phone of its own, that safety step used to leave its only phone
// marked secondary forever. Re-establish exactly one primary after all FK moves and synchronize
// users.phone, which is the denormalized primary-phone cache used by integrations and admin UI.
async function ensurePrimaryPhone(client, userId) {
    const { rows } = await client.query(
        `SELECT id, phone, verified_at, is_primary
           FROM user_phones
          WHERE user_id = $1
          ORDER BY is_primary DESC, verified_at DESC NULLS LAST, created_at DESC, id DESC
          LIMIT 1`,
        [userId]
    );
    const selected = rows[0];
    if (!selected) return null;

    await client.query(
        'UPDATE user_phones SET is_primary = (id = $2) WHERE user_id = $1',
        [userId, selected.id]
    );
    await client.query(
        'UPDATE users SET phone = $1, phone_verified_at = $2, updated_at = NOW() WHERE user_id = $3',
        [selected.phone, selected.verified_at, userId]
    );
    return selected.phone;
}

// Looks for another account that's the same real person as `userId`, preferring the
// high-confidence government_id signal when both sides have one, falling back to
// normalized name + exact birth_date match. Returns null if no candidate found or if
// `userId` itself doesn't have enough identity data on file yet to match on.
async function findMatchCandidate(client, userId) {
    const { rows } = await client.query(
        `SELECT government_id, first_name, last_name, birth_date FROM users WHERE user_id = $1 AND account_type <> 'managed'`,
        [userId]
    );
    const me = rows[0];
    if (!me) return null;

    if (me.government_id) {
        const { rows: gidRows } = await client.query(
            `SELECT user_id FROM users
             WHERE user_id != $1 AND merged_into_user_id IS NULL AND account_type <> 'managed' AND government_id = $2
             ORDER BY created_at LIMIT 1`,
            [userId, me.government_id]
        );
        if (gidRows.length > 0) return { candidateId: gidRows[0].user_id, matchedOn: 'government_id' };
    }

    if (me.birth_date && (me.first_name || me.last_name)) {
        const myName = normalizeIdentity(`${me.first_name || ''}${me.last_name || ''}`);
        const { rows: dobRows } = await client.query(
            `SELECT user_id, first_name, last_name FROM users
             WHERE user_id != $1 AND merged_into_user_id IS NULL AND account_type <> 'managed' AND birth_date = $2
               AND (first_name IS NOT NULL OR last_name IS NOT NULL)`,
            [userId, me.birth_date]
        );
        const match = dobRows.find(r => normalizeIdentity(`${r.first_name || ''}${r.last_name || ''}`) === myName);
        if (match) return { candidateId: match.user_id, matchedOn: 'name_birthday' };
    }

    return null;
}

// Resolves a table's "known conflict-prone" unique-per-user row (coaches, academy_enrollments
// — both now have a `status` column + a partial unique index excluding status='superseded',
// see migration_users_merge.sql) BEFORE the generic repoint pass below, so that pass's plain
// UPDATE succeeds instead of hitting the unique constraint. Newer row wins (kept active);
// older is marked superseded, not deleted — deleting it would destroy history other tables
// (coach_crm_*, health_plans, academy_certifications, etc.) still legitimately reference.
async function supersedeIfConflicting(client, table, timestampCol, winnerId, loserId, conflictNotes) {
    const { rows } = await client.query(
        `SELECT id, user_id, ${quoteIdent(timestampCol)} AS ts FROM ${quoteIdent(table)}
         WHERE user_id = ANY($1::text[]) AND status != 'superseded'`,
        [[winnerId, loserId]]
    );
    const winnerRow = rows.find(r => r.user_id === winnerId);
    const loserRow = rows.find(r => r.user_id === loserId);
    if (!winnerRow || !loserRow) return; // at most one side has an active row — generic repoint below is enough

    const [older, newer] = new Date(winnerRow.ts) <= new Date(loserRow.ts) ? [winnerRow, loserRow] : [loserRow, winnerRow];
    await client.query(`UPDATE ${quoteIdent(table)} SET status = 'superseded' WHERE id = $1`, [older.id]);
    if (newer.user_id === loserId) {
        await client.query(`UPDATE ${quoteIdent(table)} SET user_id = $1 WHERE id = $2`, [winnerId, newer.id]);
    }
    conflictNotes.push({ table, resolution: 'superseded_older_kept_newer', superseded_row_id: older.id, kept_row_id: newer.id });
}

// Repoints every table referencing users(user_id) from loser -> winner, discovered from
// information_schema rather than a hand-maintained list — a hardcoded list of ~30 tables
// (this schema's actual current count) risks silently missing one, which is worse than the
// small runtime cost of asking Postgres directly. Table/column names here come from the DB
// catalog itself (not user input), so string-building the UPDATE is safe.
//
// A table with a unique constraint the repoint would violate (both winner and loser hold a
// conflicting row) is NOT guessed at generically — only the two known cases (coaches,
// academy_enrollments) get automatic newer-wins resolution above. Anything else that hits a
// unique violation is left unrepointed and recorded in conflict_notes for manual review,
// rather than risking a wrong automatic resolution against a table shape this code doesn't
// actually know the semantics of.
async function repointForeignKeys(client, winnerId, loserId, conflictNotes) {
    const { rows: fks } = await client.query(`
        SELECT tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
          AND ccu.table_name = 'users' AND ccu.column_name = 'user_id'
          AND tc.table_name NOT IN ('users', 'user_merges')
    `);

    for (const { table_name, column_name } of fks) {
        // Per-row (via ctid, Postgres's physical row locator — valid for the life of this
        // transaction) rather than one bulk UPDATE for the whole table: a table where a user
        // can hold multiple rows (partners, chat_messages, etc.) would otherwise have ONE
        // colliding row abort the repoint for ALL of that user's rows in the table, since a
        // single multi-row UPDATE either fully succeeds or fully aborts on a constraint
        // violation — silently leaving legitimate non-conflicting rows unrepointed too.
        const { rows: candidates } = await client.query(
            `SELECT ctid FROM ${quoteIdent(table_name)} WHERE ${quoteIdent(column_name)} = $1`,
            [loserId]
        );
        for (const { ctid } of candidates) {
            await client.query('SAVEPOINT repoint_fk');
            try {
                await client.query(
                    `UPDATE ${quoteIdent(table_name)} SET ${quoteIdent(column_name)} = $1 WHERE ctid = $2`,
                    [winnerId, ctid]
                );
                await client.query('RELEASE SAVEPOINT repoint_fk');
            } catch (err) {
                if (err.code !== '23505' && err.code !== '23514') throw err;
                await client.query('ROLLBACK TO SAVEPOINT repoint_fk');
                conflictNotes.push({ table: table_name, column: column_name, resolution: 'unresolved_unique_conflict' });
            }
        }
    }
}

// Survivor keeps the earlier-created user_id (minimizes repointing, preserves anything
// keyed off it elsewhere like referral_code/DIDs). Runs in one transaction — never a hard
// delete: the loser row survives with merged_into_user_id set, so anything that still reads
// it directly (rather than through a repointed FK) resolves correctly, and the merge is
// recoverable by hand via user_merges if a match turns out wrong.
async function mergeUsers(winnerId, loserId, matchedOn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // A managed customer (created by a coach for a B2B channel, never signed in) is never
        // merged: matching on name + birthday or a coach-typed phone would fold a clinic's patient
        // into some consumer's account, or the reverse. Release them first; then they are regular.
        const managed = await client.query(
            `SELECT user_id FROM users WHERE user_id = ANY($1::text[]) AND account_type = 'managed'`,
            [[winnerId, loserId]]
        );
        if (managed.rows.length) throw new Error('managed_account_not_mergeable');
        const conflictNotes = [];

        await supersedeIfConflicting(client, 'coaches', 'created_at', winnerId, loserId, conflictNotes);
        await supersedeIfConflicting(client, 'academy_enrollments', 'enrolled_at', winnerId, loserId, conflictNotes);

        // user_phones has a partial-unique "one primary per user_id" index (migration_users_
        // phone_verified_multi.sql). If both winner and loser have a primary phone (virtually
        // always true), repointing the loser's rows as-is would collide with the winner's own
        // primary and — since it's one UPDATE touching both rows — silently fail the WHOLE
        // repoint via the generic unique-violation catch below, leaving the loser's phone(s)
        // unrepointed and unable to log into the merged account at all. Demote them to
        // non-primary first so the loser's phone(s) become the winner's additional phones
        // instead, and only the generic repoint's plain UPDATE has to run.
        await client.query(`UPDATE user_phones SET is_primary = false WHERE user_id = $1`, [loserId]);
        // user_emails carries the identical one-primary-per-user index (migration_user_emails.sql).
        await client.query(`UPDATE user_emails SET is_primary = false WHERE user_id = $1`, [loserId]);

        await repointForeignKeys(client, winnerId, loserId, conflictNotes);
        // The actual login identities now belong to the winner. Clear the loser's denormalized
        // cache before promoting on the winner; users.phone is unique even though the loser row
        // remains as an audit tombstone.
        await client.query(
            'UPDATE users SET phone = NULL, phone_verified_at = NULL, updated_at = NOW() WHERE user_id = $1',
            [loserId]
        );
        await ensurePrimaryPhone(client, winnerId);
        await reconcileAccessContext(client, winnerId, loserId);
        await client.query('UPDATE users SET merged_into_user_id = $1 WHERE user_id = $2', [winnerId, loserId]);
        await client.query(
            `INSERT INTO user_merges (winner_user_id, loser_user_id, matched_on, conflict_notes) VALUES ($1, $2, $3, $4)`,
            [winnerId, loserId, matchedOn, JSON.stringify(conflictNotes)]
        );

        await client.query('COMMIT');
        console.log(JSON.stringify({ level: 'INFO', msg: 'user-merge', data: { winnerId, loserId, matchedOn, conflictCount: conflictNotes.length } }));
        return conflictNotes;
    } catch (err) {
        await client.query('ROLLBACK');
        console.log(JSON.stringify({ level: 'ERROR', msg: 'user-merge-error', data: { winnerId, loserId, err: err.message } }));
        throw err;
    } finally {
        client.release();
    }
}

// Call after writing any identity field (government_id, first_name, last_name, birth_date)
// for `userId`. Best-effort: a failed merge attempt is logged, not thrown, since identity
// capture itself should still succeed even if the merge step has a problem.
async function findAndMergeDuplicateAccount(userId) {
    const client = await pool.connect();
    let match;
    try {
        match = await findMatchCandidate(client, userId);
    } finally {
        client.release();
    }
    if (!match) return null;

    // Winner = earlier-created account. Look up both created_at values to decide, then run
    // the actual merge through mergeUsers' own connection/transaction.
    const { rows } = await pool.query(
        `SELECT user_id, created_at FROM users WHERE user_id = ANY($1::text[])`,
        [[userId, match.candidateId]]
    );
    const [a, b] = rows;
    const winner = new Date(a.created_at) <= new Date(b.created_at) ? a : b;
    const loser = winner.user_id === a.user_id ? b : a;

    try {
        await mergeUsers(winner.user_id, loser.user_id, match.matchedOn);
        return winner.user_id;
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'find-and-merge-error', data: { userId, err: err.message } }));
        return null;
    }
}

// Follows merged_into_user_id transparently so a login on the loser's identity (WeChat
// openid, phone, whatever got them here) resolves to the winner's account instead of the
// now-defunct loser. nano has no session tokens to invalidate (see plan doc) — the client
// just needs the winner's user_id back, same as any normal login response.
async function resolveMergedUser(client, userRow) {
    let current = userRow;
    while (current && current.merged_into_user_id) {
        const { rows } = await client.query(`SELECT * FROM users WHERE user_id = $1`, [current.merged_into_user_id]);
        if (rows.length === 0) break;
        current = rows[0];
    }
    return current;
}

module.exports = {
    findAndMergeDuplicateAccount,
    mergeUsers,
    resolveMergedUser,
    normalizeIdentity,
    reconcileAccessContextValues,
    ensurePrimaryPhone,
};
