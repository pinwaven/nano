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

    // Fallback: try phone number match (normalize to digits only)
    const normalized = labPatientId.replace(/\D/g, '');
    if (normalized.length >= 8) {
        const phoneRes = await db.query(
            `SELECT user_id FROM users WHERE regexp_replace(phone, '\\D', '', 'g') = $1 LIMIT 1`,
            [normalized]
        );
        if (phoneRes.rows.length > 0) return phoneRes.rows[0].user_id;
    }

    return null;
}

module.exports = { matchUser };
