import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function auditTheAuditor() {
    console.log('🔍 Auditing the Auditor Claims...\n');

    // 1. Check Tables to Drop
    const tablesToDrop = [
        'agent_prompts_link_table', 'agent_prompts_parents',
        'lead_feedback_parents', 'lead_feedback_link_table',
        'leads_parents', 'leads_link_table',
        'workflow_runs_parents', 'workflow_runs_link'
    ];

    console.log('--- Checking "Tables to Drop" (Should be MISSING) ---');
    for (const table of tablesToDrop) {
        const res = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = $1
            );
        `, [table]);
        console.log(`Table '${table}': ${res.rows[0].exists ? '❌ EXISTS (Should be missing)' : '✅ MISSING'}`);
    }

    // 2. Check Columns in 'leads' and 'workflow_runs'
    console.log('\n--- Checking Redundant Columns in Source Tables ---');
    const sourceTables = ['leads', 'workflow_runs'];

    for (const table of sourceTables) {
        const res = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1
        `, [table]);
        const columns = res.rows.map(r => r.column_name);
        console.log(`\nTable '${table}' columns:`, columns.join(', '));

        // Check for specific "parent" columns mentioned by auditor
        if (table === 'leads') {
            if (columns.includes('icp_id')) console.log('   ⚠️  Has icp_id');
            if (columns.includes('run_id')) console.log('   ⚠️  Has run_id');
        }
        if (table === 'workflow_runs') {
            if (columns.includes('agent_id')) console.log('   ⚠️  Has agent_id');
            if (columns.includes('user_id')) console.log('   ⚠️  Has user_id');
            if (columns.includes('icp_id')) console.log('   ⚠️  Has icp_id');
        }
    }

    await pool.end();
}

auditTheAuditor();
