// Check agent prompts schema
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false
});

async function check() {
    try {
        console.log('🔍 Checking agent_prompts schema\n');

        // 1. Agent prompts columns
        const columns = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'agent_prompts'
            ORDER BY ordinal_position
        `);
        console.log('agent_prompts columns:');
        columns.rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

        // 2. Agent prompts data
        const data = await pool.query('SELECT * FROM agent_prompts LIMIT 3');
        console.log('\nagent_prompts data (first 3):');
        data.rows.forEach(r => console.log(`  - id=${r.id}, agent_id=${r.agent_id}, name=${r.name}`));

        // 3. Agent-related tables
        const tables = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_name LIKE 'agent%' ORDER BY table_name
        `);
        console.log('\nAgent-related tables:');
        tables.rows.forEach(r => console.log(`  - ${r.table_name}`));

        // 4. Check agent_prompts_link
        try {
            const linkColumns = await pool.query(`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'agent_prompts_link'
            `);
            console.log('\nagent_prompts_link columns:');
            linkColumns.rows.forEach(r => console.log(`  - ${r.column_name}`));

            const linkData = await pool.query('SELECT * FROM agent_prompts_link LIMIT 5');
            console.log('\nagent_prompts_link data:');
            linkData.rows.forEach(r => console.log(`  - ${JSON.stringify(r)}`));
        } catch (e) {
            console.log(`\nagent_prompts_link error: ${e.message}`);
        }

        // 5. Check ICPs for the user
        const icps = await pool.query(`
            SELECT id, name, user_id, 
                   CASE WHEN agent_config IS NOT NULL THEN 'has config' ELSE 'no config' END as has_config
            FROM icps 
            WHERE user_id = '40ac42ec-48bc-4069-864b-c47a02ed9b40'
        `);
        console.log(`\nICPs for roelof@elvison.com (${icps.rows.length}):`);
        icps.rows.forEach(r => console.log(`  - ${r.name}: ${r.has_config}`));

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await pool.end();
    }
}

check();
