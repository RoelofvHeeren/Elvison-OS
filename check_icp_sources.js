import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkWorkflowRunsForIcpData() {
    console.log('🔍 Checking workflow_runs for ICP data...\n');

    try {
        // Check if workflow_runs has icp_id populated
        const wfRuns = await pool.query(`
            SELECT COUNT(*) as total,
                   COUNT(icp_id) as with_icp,
                   COUNT(user_id) as with_user
            FROM workflow_runs
        `);
        console.log('📋 workflow_runs current state:');
        console.log(`   Total runs: ${wfRuns.rows[0].total}`);
        console.log(`   With icp_id: ${wfRuns.rows[0].with_icp}`);
        console.log(`   With user_id: ${wfRuns.rows[0].with_user}`);

        // Check metadata for ICP info
        const wfMeta = await pool.query(`
            SELECT id, icp_id, user_id, metadata->>'icpId' as meta_icp, run_name
            FROM workflow_runs
            LIMIT 10
        `);
        console.log('\n📋 workflow_runs sample (with metadata):');
        wfMeta.rows.forEach(r => {
            console.log(`   Run: ${r.run_name || r.id}`);
            console.log(`      icp_id column: ${r.icp_id || 'NULL'}`);
            console.log(`      user_id column: ${r.user_id || 'NULL'}`);
            console.log(`      metadata.icpId: ${r.meta_icp || 'NULL'}`);
        });

        // Check if leads have run association via company_name or other means
        const leadsCompanies = await pool.query(`
            SELECT COUNT(DISTINCT company_name) as unique_companies
            FROM leads
        `);
        console.log(`\n📋 Leads have ${leadsCompanies.rows[0].unique_companies} unique company names`);

        // Check companies table for ICP links
        const companiesIcp = await pool.query(`
            SELECT COUNT(*) as total, COUNT(icp_id) as with_icp
            FROM companies
        `);
        console.log(`\n📋 Companies table:`);
        console.log(`   Total: ${companiesIcp.rows[0].total}`);
        console.log(`   With icp_id: ${companiesIcp.rows[0].with_icp}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkWorkflowRunsForIcpData();
