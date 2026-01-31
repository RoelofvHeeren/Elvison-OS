import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function listFailed() {
    try {
        console.log("Connecting to DB...");
        const res = await pool.query(`
            SELECT DISTINCT company_name, company_website 
            FROM leads 
            WHERE outreach_status = 'NEEDS_RESEARCH'
            ORDER BY company_name
        `);
        console.log(`\nFound ${res.rows.length} companies that require manual research:\n`);
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

listFailed();
