import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkIntegrity() {
    console.log('🔍 Checking database integrity...\n');

    try {
        // 1. Leads without Company record
        const orphans = await pool.query(`
            SELECT DISTINCT l.company_name
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE c.id IS NULL
        `);
        console.log(`📋 Leads with no Company record: ${orphans.rowCount}`);
        if (orphans.rowCount > 0) {
            console.log('   Sample:', orphans.rows.slice(0, 5).map(r => r.company_name));
        }

        // 2. Companies with 0 leads
        const ghosts = await pool.query(`
            SELECT c.company_name
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name
            WHERE l.id IS NULL
        `);
        console.log(`\n👻 Companies with 0 leads (Ghosts): ${ghosts.rowCount}`);
        if (ghosts.rowCount > 0) {
            console.log('   Sample:', ghosts.rows.slice(0, 5).map(r => r.company_name));
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkIntegrity();
