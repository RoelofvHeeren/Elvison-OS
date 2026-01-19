import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function backfillLinkTables() {
    console.log('🚀 Starting Backfill for Link Tables (Polymorphic)...\n');
    let client;

    try {
        client = await pool.connect();

        // 1. Agent Prompts
        console.log('🔹 Backfilling agent_prompts_link...');
        const promptRes = await client.query(`
            INSERT INTO agent_prompts_link (agent_prompt_id, parent_id, parent_type)
            SELECT id, user_id, 'user' 
            FROM agent_prompts 
            WHERE user_id IS NOT NULL
            ON CONFLICT DO NOTHING
            RETURNING id;
        `);
        console.log(`   ✓ Inserted ${promptRes.rowCount} rows.`);

        // 2. Lead Feedback
        console.log('🔹 Backfilling lead_feedback_link...');
        const feedbackRes = await client.query(`
            INSERT INTO lead_feedback_link (lead_feedback_id, parent_id, parent_type)
            SELECT id, user_id, 'user'
            FROM lead_feedback
            WHERE user_id IS NOT NULL
            ON CONFLICT DO NOTHING
            RETURNING id;
        `);
        console.log(`   ✓ Inserted ${feedbackRes.rowCount} rows.`);

        // 3. Leads (This might be large)
        console.log('🔹 Backfilling leads_link (may take a moment)...');
        const leadsRes = await client.query(`
            INSERT INTO leads_link (lead_id, parent_id, parent_type)
            SELECT id, user_id, 'user'
            FROM leads
            WHERE user_id IS NOT NULL
            ON CONFLICT DO NOTHING; -- RETURNING might be too heavy for large sets
        `);
        console.log(`   ✓ Inserted leads rows (count hidden for performance, creating unique index check next).`);

        // 4. Workflow Runs
        console.log('🔹 Backfilling workflow_runs_link_table...');
        const runsRes = await client.query(`
            INSERT INTO workflow_runs_link_table (workflow_run_id, parent_id, parent_type)
            SELECT id, user_id, 'user'
            FROM workflow_runs
            WHERE user_id IS NOT NULL
            ON CONFLICT DO NOTHING
            RETURNING id;
        `);
        console.log(`   ✓ Inserted ${runsRes.rowCount} rows.`);

        console.log('\n✅ Backfill complete!');

    } catch (error) {
        console.error('❌ Error during backfill:', error);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

backfillLinkTables();
