
import { query, pool } from '../../../db/index.js';

async function checkLogs() {
    try {
        // Check if table exists
        const tableRes = await query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'workflow_step_logs'
            );
        `);
        const exists = tableRes.rows[0].exists;
        console.log(`Table 'workflow_step_logs' exists: ${exists}`);

        if (exists) {
            const countRes = await query('SELECT COUNT(*) FROM workflow_step_logs');
            console.log(`Total logs in table: ${countRes.rows[0].count}`);

            const recentRes = await query(`
                SELECT * FROM workflow_step_logs 
                ORDER BY created_at DESC 
                LIMIT 5
            `);
            console.log('Recent 5 logs:');
            console.log(recentRes.rows);
        } else {
            console.log('❌ Table workflow_step_logs DOES NOT EXIST. Creating it now...');
            await query(`
                CREATE TABLE IF NOT EXISTS workflow_step_logs (
                    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                    run_id UUID REFERENCES workflow_runs(id),
                    step VARCHAR(100),
                    message TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);
            console.log('✅ Created table workflow_step_logs.');
        }

    } catch (err) {
        console.error('Check failed:', err);
    } finally {
        await pool.end();
    }
}

checkLogs();
