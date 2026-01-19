import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function inspectDuplicates() {
    console.log('🔍 Inspecting Duplicates in Unified Tables...\n');
    try {
        const tables = ['agent_prompts_unified_link', 'lead_feedback_unified_link'];

        for (const table of tables) {
            const idCol = table === 'agent_prompts_unified_link' ? 'agent_prompt_id' : 'lead_feedback_id';

            const res = await pool.query(`
                SELECT ${idCol}, parent_id, parent_type, COUNT(*) as count
                FROM ${table}
                GROUP BY ${idCol}, parent_id, parent_type
                HAVING COUNT(*) > 1
            `);

            console.log(`📋 ${table}: Found ${res.rowCount} duplicate groups.`);
            if (res.rowCount > 0) {
                console.log('   Example duplicates:', res.rows.slice(0, 3));
            }

            const totalRes = await pool.query(`SELECT COUNT(*) FROM ${table}`);
            console.log(`   Total row count: ${totalRes.rows[0].count}\n`);
        }
    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await pool.end();
    }
}

inspectDuplicates();
