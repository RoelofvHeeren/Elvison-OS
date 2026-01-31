
import { query, pool } from '../../../db/index.js';

async function checkFailures() {
    try {
        console.log('Checking recent workflow runs...');
        const res = await query(`
            SELECT id, run_name, status, error_log, started_at, completed_at 
            FROM workflow_runs 
            ORDER BY started_at DESC 
            LIMIT 5;
        `);

        if (res.rows.length === 0) {
            console.log('No runs found.');
        } else {
            res.rows.forEach(r => {
                console.log(`\nRun ID: ${r.id}`);
                console.log(`Name: ${r.run_name}`);
                console.log(`Status: ${r.status}`);
                console.log(`Started: ${r.started_at}`);
                if (r.error_log) {
                    console.log(`❌ Error Log: ${r.error_log}`);
                } else {
                    console.log('✅ No error log.');
                }
            });
        }

    } catch (err) {
        console.error('Query failed:', err);
    } finally {
        await pool.end();
    }
}

checkFailures();
