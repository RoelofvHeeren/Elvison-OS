import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function verifyRestoration() {
    console.log('🔍 Verifying data restoration...\n');

    try {
        // 1. Leads ICP distribution
        const leadsIcp = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(icp_id) as with_icp,
                COUNT(run_id) as with_run
            FROM leads
        `);
        console.log('📋 leads table:');
        console.log(`   Total: ${leadsIcp.rows[0].total}`);
        console.log(`   With icp_id: ${leadsIcp.rows[0].with_icp}`);
        console.log(`   With run_id: ${leadsIcp.rows[0].with_run}`);

        // ICP breakdown
        const icpBreakdown = await pool.query(`
            SELECT i.name, COUNT(l.id) as lead_count
            FROM leads l
            LEFT JOIN icps i ON l.icp_id = i.id
            GROUP BY i.name
        `);
        console.log('\n📊 Leads by ICP:');
        icpBreakdown.rows.forEach(r => console.log(`   - ${r.name || 'No ICP'}: ${r.lead_count}`));

        // 2. Workflow Runs
        const wfRuns = await pool.query(`
            SELECT 
                COUNT(*) as total,
                COUNT(icp_id) as with_icp,
                COUNT(user_id) as with_user,
                COUNT(agent_id) as with_agent
            FROM workflow_runs
        `);
        console.log('\n📋 workflow_runs table:');
        console.log(`   Total: ${wfRuns.rows[0].total}`);
        console.log(`   With icp_id: ${wfRuns.rows[0].with_icp}`);
        console.log(`   With user_id: ${wfRuns.rows[0].with_user}`);
        console.log(`   With agent_id: ${wfRuns.rows[0].with_agent}`);

        // 3. Companies with leads check
        const companiesWithLeads = await pool.query(`
            SELECT COUNT(DISTINCT c.id) as companies_with_leads
            FROM companies c
            JOIN leads l ON c.company_name = l.company_name
        `);
        console.log(`\n📋 Companies with leads: ${companiesWithLeads.rows[0].companies_with_leads}`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await pool.end();
    }
}

verifyRestoration();
