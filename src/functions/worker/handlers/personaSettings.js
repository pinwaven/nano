'use strict';

/**
 * Per-persona feature settings — currently just the Viva dynamic mid-conversation
 * questionnaire feature (ask_questions action). Scoped by persona_type, not per-channel,
 * since the feature is already a persona-level concept in code (gated by which persona's
 * prompt templates are loaded). Managed from the admin panel's "AI Persona" tab.
 */
const { pool } = require('../lib/db');

const VALID_PERSONA_TYPES = new Set(['nano', 'viva']);

// Used if the DB is unreachable or a persona has no row yet — must fail open (feature stays
// enabled) so a transient DB issue never silently kills the feature for everyone.
const DEFAULT_SETTINGS = { dynamic_questionnaires_enabled: true, dynamic_questionnaire_cooldown_hours: 24 };

async function getPersonaSettings(personaType) {
    try {
        const result = await pool.query(
            `SELECT dynamic_questionnaires_enabled, dynamic_questionnaire_cooldown_hours
             FROM persona_settings WHERE persona_type = $1`,
            [personaType]
        );
        if (result.rowCount === 0) return { ...DEFAULT_SETTINGS };
        return result.rows[0];
    } catch (err) {
        console.error(JSON.stringify({ level: 'ERROR', msg: 'getPersonaSettings failed, using defaults', personaType, error: err.message }));
        return { ...DEFAULT_SETTINGS };
    }
}

async function handleGetPersonaSettings() {
    try {
        const result = await pool.query(
            `SELECT persona_type, dynamic_questionnaires_enabled, dynamic_questionnaire_cooldown_hours, updated_at, updated_by
             FROM persona_settings ORDER BY persona_type`
        );
        return { success: true, settings: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutPersonaSettings(personaType, body, updatedBy) {
    try {
        if (!VALID_PERSONA_TYPES.has(personaType)) {
            return { success: false, error: `persona_type must be one of: ${[...VALID_PERSONA_TYPES].join(', ')}` };
        }
        if (typeof body?.dynamic_questionnaires_enabled !== 'boolean') {
            return { success: false, error: 'dynamic_questionnaires_enabled must be a boolean' };
        }
        const cooldown = parseInt(body?.dynamic_questionnaire_cooldown_hours, 10);
        if (!Number.isFinite(cooldown) || cooldown < 1 || cooldown > 168) {
            return { success: false, error: 'dynamic_questionnaire_cooldown_hours must be an integer between 1 and 168' };
        }

        const result = await pool.query(
            `INSERT INTO persona_settings (persona_type, dynamic_questionnaires_enabled, dynamic_questionnaire_cooldown_hours, updated_at, updated_by)
             VALUES ($1, $2, $3, NOW(), $4)
             ON CONFLICT (persona_type) DO UPDATE SET
                dynamic_questionnaires_enabled = EXCLUDED.dynamic_questionnaires_enabled,
                dynamic_questionnaire_cooldown_hours = EXCLUDED.dynamic_questionnaire_cooldown_hours,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
             RETURNING persona_type, dynamic_questionnaires_enabled, dynamic_questionnaire_cooldown_hours, updated_at, updated_by`,
            [personaType, body.dynamic_questionnaires_enabled, cooldown, updatedBy || null]
        );
        return { success: true, setting: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    getPersonaSettings,
    handleGetPersonaSettings,
    handlePutPersonaSettings,
};
