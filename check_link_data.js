import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkLinkTablesForData() {
    console.log('🔍 Checking link tables for repopulation data...\n');

    try {
        // 1. Leads Link - Check for icp relationships
        const leadsLink = await pool.query(`
            SELECT COUNT(*) as count, 
                   COUNT(DISTINCT lead_id) as unique_leads,
                   COUNT(DISTINCT parent_id) as unique_parents
            FROM leads_link
        `);
        console.log('📋 leads_link:');
        console.log(`   Total rows: ${leadsLink.rows[0].count}`);
        console.log(`   Unique leads: ${leadsLink.rows[0].unique_leads}`);
        console.log(`   Unique parents: ${leadsLink.rows[0].unique_parents}`);

        // Sample data
        const leadsSample = await pool.query(`SELECT * FROM leads_link LIMIT 5`);
        console.log('   Sample:', leadsSample.rows);

        // 2. Workflow Runs Link
        const wfLink = await pool.query(`
            SELECT COUNT(*) as count, 
                   COUNT(DISTINCT workflow_run_id) as unique_runs
            FROM workflow_runs_link_table
        `);
        console.log('\n📋 workflow_runs_link_table:');
        console.log(`   Total rows: ${wfLink.rows[0].count}`);
        console.log(`   Unique runs: ${wfLink.rows[0].unique_runs}`);

        // Sample data
        const wfSample = await pool.query(`SELECT * FROM workflow_runs_link_table LIMIT 5`);
        console.log('   Sample:', wfSample.rows);

        // 3. Check current state of leads.icp_id
        const leadsIcp = await pool.query(`
            SELECT COUNT(*) as total,
                   COUNT(icp_id) as with_icp,
                   COUNT(run_id) as with_run
            FROM leads
        `);
        console.log('\n📋 leads table current state:');
        console.log(`   Total leads: ${leadsIcp.rows[0].total}`);
        console.log(`   With icp_id: ${leadsIcp.rows[0].with_icp}`);
        console.log(`   With run_id: ${leadsIcp.rows[0].with_run}`);

        // 4. Check ICPs exist
        const icps = await pool.query(`SELECT id, name FROM icps`);
        console.log('\n📋 Available ICPs:');
        icps.rows.forEach(r => console.log(`   - ${r.name} (${r.id})`));

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkLinkTablesForData();
