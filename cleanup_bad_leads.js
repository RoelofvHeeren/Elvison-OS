import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const BAD_KEYWORDS = [
    'Legal', 'Counsel', 'Attorney', 'Compliance', 'Audit',
    'Human Resources', 'HR', 'Talent', 'Recruit',
    'Marketing', 'Brand', 'Communications', 'PR', 'Media',
    'IT', 'Technology', 'Systems', 'Software', 'Support',
    'Accounting', 'Controller', 'Tax', 'Finance' // Finance can be risky, but usually "Director of Finance" is okay for smaller firms, but for larger ones maybe not. "Investments" is better. But I'll stick to non-investment roles.
    // Actually "Finance" is often a Decision Maker in real estate. I'll exclude it from the BAD list for now, unless it's "Finance Manager" or "Accounting".
];

// Refined list
const DELETE_KEYWORDS = [
    'Legal', 'Counsel', 'Attorney', 'Compliance', 'Law',
    'Audit', 'Risk',
    'Human Resources', 'HR', 'People', 'Talent', 'Culture',
    'Marketing', 'Brand', 'Communications', 'PR', 'Media',
    'IT', 'Technology', 'Systems', 'Software', 'Engineer', 'Developer', 'Support', 'Admin',
    'Assurance', 'Tax', 'Controller', 'Accountant', 'Accounting'
];

async function cleanupBadLeads() {
    console.log('🧹 Starting Bad Lead Cleanup...\n');

    try {
        // Construct WHERE clause
        const conditions = DELETE_KEYWORDS.map(k => `job_title ILIKE '%${k}%'`).join(' OR ');

        const preview = await pool.query(`
            SELECT id, person_name, company_name, job_title 
            FROM leads 
            WHERE ${conditions}
        `);

        if (preview.rows.length === 0) {
            console.log('✅ No bad job titles found.');
            return;
        }

        console.log(`⚠️ Found ${preview.rows.length} leads with suspect titles:`);
        preview.rows.forEach(l => console.log(`   - ${l.person_name} (${l.company_name}): ${l.job_title}`));

        // Delete from leads_link first
        const leadIds = preview.rows.map(r => r.id);

        await pool.query(`
            DELETE FROM leads_link 
            WHERE lead_id = ANY($1::uuid[])
        `, [leadIds]);

        // Delete from leads
        await pool.query(`
            DELETE FROM leads 
            WHERE id = ANY($1::uuid[])
        `, [leadIds]);

        console.log(`\n🗑️  Deleted ${preview.rows.length} leads.`);

    } catch (error) {
        console.error('❌ Cleanup failed:', error);
    } finally {
        await pool.end();
    }
}

cleanupBadLeads();
