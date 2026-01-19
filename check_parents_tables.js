import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkParentsTables() {
    console.log('🔍 Checking for _parents tables...\n');
    const tables = [
        'agent_prompts_parents',
        'lead_feedback_parents',
        'leads_parents',
        'workflow_runs_parents'
    ];

    try {
        for (const table of tables) {
            const res = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = $1
                );
            `, [table]);

            console.log(`Table '${table}': ${res.rows[0].exists ? '✅ EXISTS' : '❌ MISSING'}`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

checkParentsTables();
