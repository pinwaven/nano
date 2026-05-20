#!/usr/bin/env node

require('dotenv').config();

const args = process.argv.slice(2);
const prodFlag = args.includes('--prod');
if (prodFlag) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_PROD;
  process.argv = process.argv.filter(a => a !== '--prod');
}

const { pool } = require('../src/functions/worker/lib/db');

async function resetChip(chipCode) {
    if (!chipCode) {
        console.error('Usage: node reset-test-chip.js <chip_code>');
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check if chip exists
        const chipCheck = await client.query('SELECT id, status FROM kino_chips WHERE chip_code = $1', [chipCode]);
        if (chipCheck.rows.length === 0) {
            console.error(`Error: Chip ${chipCode} not found in kino_chips table.`);
            await client.query('ROLLBACK');
            return;
        }

        // 2. Reset status in kino_chips
        const chipUpdate = await client.query(
            "UPDATE kino_chips SET status = 'available' WHERE chip_code = $1",
            [chipCode]
        );
        console.log(`- Updated kino_chips status to 'available' for ${chipCode} (${chipUpdate.rowCount} row)`);

        // 3. Delete associated scan records
        const scanDelete = await client.query(
            "DELETE FROM scans WHERE chip_id = $1",
            [chipCode]
        );
        console.log(`- Deleted associated scan records (${scanDelete.rowCount} rows)`);

        await client.query('COMMIT');
        console.log(`Successfully reset chip: ${chipCode}`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Failed to reset chip:', err.message);
    } finally {
        client.release();
    }
}

const targetCode = process.argv[2];
resetChip(targetCode).then(() => process.exit(0));
