// Quick diagnostic script to check database state
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('DATABASE_URL prefix:', process.env.DATABASE_URL?.substring(0, 50) + '...');

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function diagnose() {
    try {
        console.log('\n🔍 Database Diagnostic Check\n');

        // 1. Check leads_link_table
        try {
            const linkTable = await pool.query('SELECT COUNT(*) as total FROM leads_link_table');
            console.log(`leads_link_table rows: ${linkTable.rows[0].total}`);
        } catch (e) {
            console.log(`leads_link_table check failed: ${e.message}`);
        }

        // 2. Check total leads
        try {
            const leads = await pool.query("SELECT COUNT(*) as total FROM leads WHERE status != 'DISQUALIFIED'");
            console.log(`Total leads (non-disqualified): ${leads.rows[0].total}`);
        } catch (e) {
            console.log(`Leads check failed: ${e.message}`);
        }

        // 3. Check leads with user_id
        try {
            const leadsWithUser = await pool.query("SELECT COUNT(*) as total FROM leads WHERE user_id IS NOT NULL");
            console.log(`Leads with user_id set: ${leadsWithUser.rows[0].total}`);
        } catch (e) {
            console.log(`Leads user_id check failed: ${e.message}`);
        }

        // 4. Check companies
        try {
            const companies = await pool.query('SELECT COUNT(*) as total FROM companies');
            console.log(`Total companies: ${companies.rows[0].total}`);
        } catch (e) {
            console.log(`Companies check failed: ${e.message}`);
        }

        // 5. Check ICPs
        try {
            const icps = await pool.query('SELECT id, name, LEFT(description, 80) as desc_preview FROM icps LIMIT 5');
            console.log(`\nICPs (first 5):`);
            icps.rows.forEach(r => console.log(`  - ${r.name}: ${r.desc_preview || '(no description)'}`));
        } catch (e) {
            console.log(`ICPs check failed: ${e.message}`);
        }

        // 6. Check if leads_link_table has entries for users
        try {
            const userLinks = await pool.query("SELECT COUNT(*) as total FROM leads_link_table WHERE parent_type = 'user'");
            console.log(`\nleads_link_table user entries: ${userLinks.rows[0].total}`);
        } catch (e) {
            console.log(`User links check failed: ${e.message}`);
        }

        // 7. Sample of leads to see structure
        try {
            const sampleLeads = await pool.query('SELECT id, company_name, user_id, icp_id, status FROM leads LIMIT 3');
            console.log(`\nSample leads:`);
            sampleLeads.rows.forEach(r => console.log(`  - ${r.company_name} (user: ${r.user_id}, icp: ${r.icp_id}, status: ${r.status})`));
        } catch (e) {
            console.log(`Sample leads check failed: ${e.message}`);
        }

        // 8. Check tables that exist
        try {
            const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
            console.log(`\nPublic tables:`);
            tables.rows.forEach(r => console.log(`  - ${r.table_name}`));
        } catch (e) {
            console.log(`Tables check failed: ${e.message}`);
        }

    } catch (error) {
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await pool.end();
    }
}

diagnose();
