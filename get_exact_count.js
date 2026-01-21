import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function getExactCount() {
    console.log('🔍 Getting EXACT lead counts...\n');

    try {
        // Total leads in database
        const { rows: total } = await pool.query(`SELECT COUNT(*) as count FROM leads`);
        console.log(`📊 Total leads in DB: ${total[0].count}`);

        // Leads linked to user (what shows in CRM)
        const { rows: linked } = await pool.query(`
            SELECT COUNT(DISTINCT l.id) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
        `);
        console.log(`👤 Leads linked to user: ${linked[0].count}`);

        // Non-disqualified leads (what actually shows in CRM by default)
        const { rows: active } = await pool.query(`
            SELECT COUNT(DISTINCT l.id) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
        `);
        console.log(`✅ Active (non-disqualified) leads: ${active[0].count}`);

        // Breakdown by status
        const { rows: byStatus } = await pool.query(`
            SELECT l.status, COUNT(*) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            GROUP BY l.status
            ORDER BY count DESC
        `);
        console.log('\n📋 Breakdown by status:');
        byStatus.forEach(r => console.log(`  - ${r.status || 'NULL'}: ${r.count}`));

        // Unique companies
        const { rows: companies } = await pool.query(`
            SELECT COUNT(DISTINCT l.company_name) as count
            FROM leads l
            JOIN leads_link link ON l.id = link.lead_id
            WHERE link.parent_type = 'user'
            AND l.status != 'DISQUALIFIED'
        `);
        console.log(`\n🏢 Unique companies: ${companies[0].count}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

getExactCount();
