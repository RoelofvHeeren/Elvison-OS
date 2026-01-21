import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkMissingEmails() {
    console.log('🔍 Checking Missing Email Addresses...\n');

    try {
        // Count leads with missing emails
        const { rows: countRows } = await pool.query(`
            SELECT COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.email IS NULL OR l.email = '')
        `);

        console.log(`📧 Leads with MISSING email addresses: ${countRows[0].count}`);

        // Sample companies
        const { rows: sampleRows } = await pool.query(`
            SELECT DISTINCT l.company_name, COUNT(*) as lead_count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
            AND (l.email IS NULL OR l.email = '')
            GROUP BY l.company_name
            ORDER BY lead_count DESC
            LIMIT 10
        `);

        console.log('\n📋 Top Companies with Missing Emails:');
        sampleRows.forEach(r => {
            console.log(`  - ${r.company_name}: ${r.lead_count} leads`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

checkMissingEmails();
