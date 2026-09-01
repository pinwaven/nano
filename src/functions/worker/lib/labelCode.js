'use strict';

const crypto = require('crypto');
const { pool } = require('./db');

/**
 * The `WVB…` code that identifies one formulation from the moment it is generated, through the
 * printed box label, to the scan that activates it.
 *
 * ONE code space, two tables. It is minted onto `nutrition_plans.label_code` when the formula is
 * generated — before any box exists, because the QR is shown to the user and printed on the box
 * that is later compounded from it — and the `boxes` row for that plan reuses the same value. A
 * collision between the two would mean a scan resolving to the wrong person's capsules, so
 * uniqueness is checked against BOTH tables rather than each minting into its own space.
 *
 * The `WVB` + 12-hex shape is load-bearing, not cosmetic: `handlePostBoxClaim` extracts it with
 * /WVB[0-9A-Fa-f]{12}/ from whatever the scanner returns, which is what lets the same regex read
 * a bare code, nano's own box URL, and the GCN aeviva label URL the QR now encodes.
 */
async function generateLabelCode() {
    for (let i = 0; i < 10; i++) {
        const code = 'WVB' + crypto.randomBytes(6).toString('hex').toUpperCase();
        const { rows } = await pool.query(
            `SELECT 1 FROM boxes WHERE box_code = $1
             UNION ALL
             SELECT 1 FROM nutrition_plans WHERE label_code = $1
             LIMIT 1`,
            [code]
        );
        if (rows.length === 0) return code;
    }
    throw new Error('Failed to generate a unique label code');
}

module.exports = { generateLabelCode };
