import { query, pool } from './db/index.js';

async function cleanup() {
    console.log("🧹 Starting database cleanup...");

    const tablesToClear = [
        'leads_link',
        'lead_feedback_link',
        'lead_feedback',
        'leads',
        'company_team_members',
        'companies',
        'researched_companies',
        'workflow_runs_link_table',
        'agent_results',
        'run_feedback',
        'workflow_step_logs',
        'workflow_logs',
        'workflow_runs'
    ];

    try {
        await query('BEGIN');

        for (const table of tablesToClear) {
            console.log(`  - Clearing ${table}...`);
            await query(`DELETE FROM ${table}`);
        }

        await query('COMMIT');
        console.log("✅ Database cleanup complete. Leads, companies, and exclusions have been reset.");
        console.log("ℹ️ ICPs, Users, and Agent Prompts were preserved.");
    } catch (error) {
        await query('ROLLBACK');
        console.error("❌ Cleanup failed:", error.message);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

cleanup();
