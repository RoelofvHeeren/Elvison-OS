import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkAgentPromptsColumn() {
    try {
        const res = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'agent_prompts' 
            AND column_name = 'parent_id';
        `);

        if (res.rows.length > 0) {
            console.log('✅ parent_id column EXISTS in agent_prompts.');
        } else {
            console.log('❌ parent_id column does NOT exist in agent_prompts.');
        }

        const tablesToCheck = [
            'agent_prompts_link',
            'leads_link',
            'lead_feedback_link',
            'workflow_runs_link_table'
        ];

        for (const table of tablesToCheck) {
            const fkRes = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = $1;
            `, [table]);

            if (fkRes.rows.length > 0) {
                console.log(`✅ ${table} table EXISTS.`);
            } else {
                console.log(`❌ ${table} table does NOT exist.`);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkAgentPromptsColumn();
