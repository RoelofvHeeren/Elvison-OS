import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectFlagged() {
    try {
        console.log("🔍 Inspecting 'NEEDS_RESEARCH' leads...");
        const res = await pool.query(`
            SELECT id, company_name, company_website, company_profile, outreach_reason
            FROM leads 
            WHERE outreach_status = 'NEEDS_RESEARCH'
            LIMIT 5
        `);

        console.log(`Found ${res.rows.length} sample leads:\n`);

        res.rows.forEach(lead => {
            console.log(`ID: ${lead.id}`);
            console.log(`Company: ${lead.company_name}`);
            console.log(`Website: ${lead.company_website}`);
            console.log(`Reason: ${lead.outreach_reason}`);
            console.log(`Profile Length: ${lead.company_profile?.length || 0}`);
            console.log(`Profile Preview: ${lead.company_profile?.substring(0, 100)}...`);
            console.log("-".repeat(50));
        });

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

inspectFlagged();
