
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function wipeClean() {
    const client = await pool.connect();
    try {
        console.log("⚠️ STARTING FULL DATABASE WIPE (Leads, Companies, Workflow Runs)...");

        // Order matters due to foreign key constraints
        await client.query('BEGIN');

        console.log("🗑️ Clearing feedback and links...");
        await client.query('TRUNCATE TABLE run_feedback CASCADE');
        await client.query('TRUNCATE TABLE leads_link CASCADE');
        console.log("🗑️ Clearing workflow history...");
        await client.query('DELETE FROM leads');
        // TRUNCATE CASCADE on workflow_runs might be dangerous if relationships are inverted. 
        // Using DELETE serves the same purpose but strictly follows FKs (or fails if blocked).
        // Given we want to wipe runs, DELETE FROM is safer to avoid accidental upstream wipes.
        await client.query('DELETE FROM run_feedback');
        await client.query('DELETE FROM leads_link');
        await client.query('DELETE FROM workflow_runs_link_table');
        await client.query('DELETE FROM agent_results');

        await client.query('DELETE FROM workflow_runs');

        console.log("🗑️ Clearing companies and exclusion lists...");
        await client.query('DELETE FROM companies');

        // OPTIONAL: Clear Funds if they are part of "companies" logic? 
        // User said "no exclusion list", usually 'companies' table IS the exclusion list source.

        await client.query('COMMIT');
        console.log("✅ DATABASE WIPED CLEAN. Ready for fresh run.");

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ WIPE FAILED:", e);
    } finally {
        client.release();
        await pool.end();
    }
}

wipeClean();
