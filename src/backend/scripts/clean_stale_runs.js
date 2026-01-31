
import { query, pool } from '../../../db/index.js';

async function cleanStaleRuns() {
    try {
        console.log('Cleaning up stale RUNNING jobs...');

        // Mark any job started > 1 hour ago and still RUNNING as FAILED
        const res = await query(`
            UPDATE workflow_runs 
            SET status = 'FAILED', 
                error_log = 'System Crash: Workflow terminated unexpectedly (likely due to geography bug).',
                completed_at = NOW()
            WHERE status = 'RUNNING' 
              AND started_at < NOW() - INTERVAL '1 hour'
            RETURNING id, run_name;
        `);

        if (res.rows.length === 0) {
            console.log('No stale runs found.');
        } else {
            console.log(`✅ Fixed ${res.rows.length} stale runs:`);
            res.rows.forEach(r => console.log(`- ${r.run_name} (${r.id})`));
        }

    } catch (err) {
        console.error('Update failed:', err);
    } finally {
        await pool.end();
    }
}

cleanStaleRuns();
