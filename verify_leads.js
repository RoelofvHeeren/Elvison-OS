import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function checkRecentLeads() {
    try {
        console.log('Checking recent leads...');
        const res = await pool.query(`
            SELECT id, company_name, person_name, email, status, created_at, source
            FROM leads
            ORDER BY created_at DESC
            LIMIT 10
        `);

        if (res.rows.length === 0) {
            console.log('No leads found in the database.');
        } else {
            console.log('Most recent leads:');
            res.rows.forEach(lead => {
                console.log(`[${lead.created_at.toISOString()}] ${lead.company_name} - ${lead.person_name} (${lead.email}) [Status: ${lead.status}] [Source: ${lead.source}]`);
            });
        }

        const stats = await pool.query(`
            SELECT count(*) as total,
                   count(*) filter (where created_at > NOW() - INTERVAL '1 hour') as last_hour
            FROM leads
        `);
        console.log(`\nTotal leads: ${stats.rows[0].total}`);
        console.log(`Leads added in last hour: ${stats.rows[0].last_hour}`);

        // Check workflow runs
        const runs = await pool.query(`
            SELECT id, status, started_at, completed_at
            FROM workflow_runs
            ORDER BY started_at DESC
            LIMIT 5
        `);
        console.log('\nRecent Workflow Runs:');
        runs.rows.forEach(run => {
            console.log(`[${run.started_at.toISOString()}] ${run.id} - ${run.status}`);
        });

    } catch (err) {
        console.error('Error querying database:', err);
    } finally {
        await pool.end();
    }
}

checkRecentLeads();
