require('dotenv').config();
const { pool } = require('../src/lib/db');

async function migrate() {
    console.log(`[Migration] Adding "language" column to "coaches" table...`);
    try {
        const checkColumn = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'coaches' AND column_name = 'language'
            )
        `);
        
        if (!checkColumn.rows[0].exists) {
            await pool.query("ALTER TABLE coaches ADD COLUMN language TEXT DEFAULT 'zh'");
            console.log('[Migration] Column "language" added successfully.');
        } else {
            console.log('[Migration] Column "language" already exists.');
        }
    } catch (err) {
        console.error('[Migration] Error:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
