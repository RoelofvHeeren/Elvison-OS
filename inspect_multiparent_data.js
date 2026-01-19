import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectMultiParentData() {
    console.log('🔍 Inspecting partial data for duplicates/multi-parents...\n');

    const tables = [
        { name: 'agent_prompts_link', entityCol: 'agent_prompt_id' },
        { name: 'lead_feedback_link', entityCol: 'lead_feedback_id' },
        { name: 'leads_link', entityCol: 'lead_id' },
        { name: 'workflow_runs_link_table', entityCol: 'workflow_run_id' }
    ];

    try {
        for (const t of tables) {
            console.log(`\n📋 Table: ${t.name}`);

            // 1. Exact Duplicates (Same Entity, Same Parent)
            const exactDupes = await pool.query(`
                SELECT count(*) as count
                FROM (
                    SELECT ${t.entityCol}, parent_id
                    FROM ${t.name}
                    GROUP BY ${t.entityCol}, parent_id
                    HAVING count(*) > 1
                ) as sub;
            `);
            console.log(`   - Exact Duplicates (Rows with same Entity & Parent): ${exactDupes.rows[0].count}`);

            // 2. Multi-Parent (Same Entity, Different Parents)
            const multiParents = await pool.query(`
                SELECT count(*) as count
                FROM (
                    SELECT ${t.entityCol}
                    FROM ${t.name}
                    GROUP BY ${t.entityCol}
                    HAVING count(DISTINCT parent_id) > 1
                ) as sub;
            `);
            console.log(`   - Multi-Parents (Entities linked to >1 different Parents): ${multiParents.rows[0].count}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

inspectMultiParentData();
