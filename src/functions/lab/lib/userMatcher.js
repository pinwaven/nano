'use strict';

const db = require('./db');

/**
 * Resolve a lab patient ID to a Nano user_id.
 *
 * Primary lookup: lab_user_mappings (exact match by lab_name + lab_patient_id).
 * Fallback: users.phone match (for labs that send a phone number as patient ID).
 *
 * Returns null if no match is found — caller should log and skip the result.
 */
async function matchUser(labName, labPatientId) {
    if (!labPatientId) return null;

    const mappingRes = await db.query(
        'SELECT user_id FROM lab_user_mappings WHERE lab_name = $1 AND lab_patient_id = $2 LIMIT 1',
        [labName, labPatientId]
    );
    if (mappingRes.rows.length > 0) return mappingRes.rows[0].user_id;

    // Fallback: try phone number match (normalize to digits only).
    // China numbers are stored on users.phone as E.164 (+86...), while labs may
    // send either a bare 11-digit national number or an 86-prefixed one — match
    // both by comparing against a candidate set with and without the 86 prefix.
    const normalized = labPatientId.replace(/\D/g, '');
    if (normalized.length >= 8) {
        const candidates = new Set([normalized]);
        if (/^1\d{10}$/.test(normalized)) candidates.add(`86${normalized}`);
        if (/^86\d{11}$/.test(normalized)) candidates.add(normalized.slice(2));

        const phoneRes = await db.query(
            `SELECT user_id FROM users WHERE regexp_replace(phone, '\\D', '', 'g') = ANY($1) LIMIT 1`,
            [Array.from(candidates)]
        );
        if (phoneRes.rows.length > 0) return phoneRes.rows[0].user_id;
    }

    return null;
}

module.exports = { matchUser };
