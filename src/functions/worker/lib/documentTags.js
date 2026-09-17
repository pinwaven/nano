'use strict';

/**
 * Document tags — what a document says about the person — and their mirror into
 * user_memory_facts. Contract 3 of the extraction API (CLAUDE.md §39).
 *
 * health_document_tags is the RECORD: every fact and descriptor a document stated, per document,
 * with its tense, its date and the cell it came from. user_memory_facts is what the rest of nano
 * READS — product filtering (§37), formulation (§28), every prompt through getFactMemoryBlock
 * (§27). This module is the only thing that moves rows from the first to the second, and the
 * rules it holds are what make an auto-written statement about a person safe to act on:
 *
 *   - Only a FACT (tag_key resolves in tag_catalog) is ever mirrored. A descriptor never is,
 *     whatever it says.
 *   - Only when the catalog row names a memory_category. family_history is NULL for every row
 *     on purpose; lifestyle / result / procedure too, until something reads them.
 *   - Resolution is per tag_key across ALL of the user's documents: the newest `since` wins.
 *     A 2024 「服用他汀」 and a 2026 「已停用」 resolve to stopped; only `current` is mirrored.
 *   - The mirrored fact_zh is the catalog's short name_zh, never the document's sentence —
 *     §27's rule (fact_zh is rendered uncapped into ~14 prompts, and §40's hazard: a long
 *     sentence can swallow an ingredient name in the prose collision check).
 *   - A mirrored row carries tag_key and is MANAGED: deactivated when the key resolves away
 *     from current, or when its document is cleared. A row without tag_key — the user's own
 *     words in chat, an admin's entry — is never touched, even when it reads the same.
 *
 * Everything here takes the pool as a parameter so the offline tests can stub it the way
 * tests/doc-extraction-queue.test.js does.
 */

const EXTRACTION_SOURCE = 'document_extracted';

// One multi-row INSERT for a document's tags, in submission order. Returns the row count.
async function writeDocumentTags(pool, { userId, documentId, tags }) {
    const rows = (tags || []).filter(t => t && t.text);
    if (rows.length === 0) return 0;
    const params = [userId, documentId];
    const tuples = rows.map((t, i) => {
        const base = params.length;
        params.push(t.kind, t.tag_key || null, t.category, t.text, t.value || null, t.status || 'current',
            t.since || null, t.source || null, t.confidence == null ? null : t.confidence, t.reason || null, i);
        return `($1, $2, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::date, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
    });
    await pool.query(
        `INSERT INTO health_document_tags
            (user_id, document_id, kind, tag_key, category, text, value, status, since, source_ref, confidence, reason, sort_order)
         VALUES ${tuples.join(', ')}`,
        params
    );
    return rows.length;
}

async function clearDocumentTags(pool, documentId, userId) {
    const { rowCount } = await pool.query(
        'DELETE FROM health_document_tags WHERE document_id = $1 AND user_id = $2',
        [documentId, userId]
    );
    return rowCount;
}

/**
 * Newest statement per tag_key across every document of the user. Each row carries the catalog
 * names so a consumer needs no second lookup, and `history` (older statements for the same key)
 * so "was once current" is not lost.
 */
async function resolveUserTags(pool, userId) {
    const { rows } = await pool.query(
        `SELECT t.id, t.document_id, t.tag_key, t.category, t.text, t.value, t.status,
                t.since::text AS since, t.source_ref, t.confidence,
                c.name_zh, c.name_en, c.memory_category
           FROM health_document_tags t
           JOIN tag_catalog c ON c.tag_key = t.tag_key
          WHERE t.user_id = $1 AND t.kind = 'fact' AND t.tag_key IS NOT NULL
          ORDER BY t.tag_key, t.since DESC NULLS LAST, t.id DESC`,
        [userId]
    );
    const byKey = new Map();
    for (const r of rows) {
        const cur = byKey.get(r.tag_key);
        const point = {
            id: Number(r.id), document_id: Number(r.document_id), text: r.text, value: r.value,
            status: r.status, since: r.since, source_ref: r.source_ref,
            confidence: r.confidence == null ? null : Number(r.confidence),
        };
        if (!cur) {
            byKey.set(r.tag_key, {
                tag_key: r.tag_key, category: r.category, name_zh: r.name_zh, name_en: r.name_en,
                memory_category: r.memory_category || null, ...point, history: [],
            });
        } else {
            cur.history.push(point);
        }
    }
    return [...byKey.values()];
}

/**
 * Make the user's managed memory facts equal the set of CURRENT facts whose catalog row names a
 * memory_category. Idempotent; call after any write or clear of a document's tags.
 * @returns {{inserted:number, deactivated:number, wanted:number}}
 */
async function syncMemoryFactsFromTags(pool, userId) {
    const resolved = await resolveUserTags(pool, userId);
    const wanted = new Map();
    for (const r of resolved) {
        if (r.status !== 'current' || !r.memory_category) continue;
        wanted.set(r.tag_key, r);
    }

    const { rows: existing } = await pool.query(
        `SELECT id, tag_key FROM user_memory_facts
          WHERE user_id = $1 AND tag_key IS NOT NULL AND status = 'active'`,
        [userId]
    );
    let deactivated = 0;
    const stale = existing.filter(e => !wanted.has(e.tag_key)).map(e => Number(e.id));
    if (stale.length > 0) {
        const { rowCount } = await pool.query(
            `UPDATE user_memory_facts SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
              WHERE id = ANY($1::int[])`,
            [stale]
        );
        deactivated = rowCount;
    }

    let inserted = 0;
    for (const r of wanted.values()) {
        // A result tag's fact_zh carries its value (HPV52 阳性 is the fact; HPV52 alone is a
        // test name) — but no result row has a memory_category today, so this is future-proofing.
        const factZh = r.value ? `${r.name_zh} ${r.value}` : r.name_zh;
        // The dedup index is (user_id, category, fact_zh) WHERE status='active'. On a collision
        // with the user's OWN statement of the same fact (chat / admin), that row stays theirs:
        // tag_key is set only on a row this feature wrote, so a later `stopped` from a document
        // can never silence what the person said themselves.
        const { rowCount } = await pool.query(
            `INSERT INTO user_memory_facts
                (user_id, category, fact_zh, source, source_document_id, tag_key)
             VALUES ($1, $2, $3, '${EXTRACTION_SOURCE}', $4, $5)
             ON CONFLICT (user_id, category, fact_zh) WHERE status = 'active'
             DO UPDATE SET last_mentioned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                           tag_key = CASE WHEN user_memory_facts.source = '${EXTRACTION_SOURCE}'
                                          THEN EXCLUDED.tag_key ELSE user_memory_facts.tag_key END,
                           source_document_id = CASE WHEN user_memory_facts.source = '${EXTRACTION_SOURCE}'
                                          THEN EXCLUDED.source_document_id ELSE user_memory_facts.source_document_id END
             RETURNING (xmax = 0) AS inserted`,
            [userId, r.memory_category, factZh, r.document_id, r.tag_key]
        );
        if (rowCount > 0) inserted++;
    }
    return { inserted, deactivated, wanted: wanted.size };
}

// The tags of one document, for the document list and the report sheet. Descriptors included —
// they are shown, just never acted on.
async function fetchDocumentTags(pool, documentId, userId) {
    const { rows } = await pool.query(
        `SELECT t.id, t.kind, t.tag_key, t.category, t.text, t.value, t.status,
                t.since::text AS since, t.source_ref, t.confidence, t.reason,
                c.name_zh, c.name_en
           FROM health_document_tags t
           LEFT JOIN tag_catalog c ON c.tag_key = t.tag_key
          WHERE t.document_id = $1 AND t.user_id = $2
          ORDER BY t.sort_order, t.id`,
        [documentId, userId]
    );
    return rows.map(r => ({
        id: Number(r.id), kind: r.kind, tag_key: r.tag_key, category: r.category, text: r.text,
        value: r.value, status: r.status, since: r.since, source_ref: r.source_ref,
        confidence: r.confidence == null ? null : Number(r.confidence), reason: r.reason,
        name_zh: r.name_zh || null, name_en: r.name_en || null,
    }));
}

module.exports = { writeDocumentTags, clearDocumentTags, resolveUserTags, syncMemoryFactsFromTags, fetchDocumentTags };
