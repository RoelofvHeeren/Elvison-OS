
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const { Client } = pg;

const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const client = new Client({
    connectionString: envConfig.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function clearData() {
    try {
        await client.connect();

        console.log("--- STARTING DATA CLEAR ---");

        // 0. Clear Leads Link (Foreign Key)
        const resLinks = await client.query('DELETE FROM leads_link');
        console.log(`Deleted ${resLinks.rowCount} links.`);

        // 1. Clear Leads
        const resLeads = await client.query('DELETE FROM leads');
        console.log(`Deleted ${resLeads.rowCount} leads.`);

        // 2. Clear Companies
        const resCompanies = await client.query('DELETE FROM companies');
        console.log(`Deleted ${resCompanies.rowCount} companies from display table.`);

        // 3. Clear Researched Companies (Memory)
        // Check if table exists first to avoid error if I'm wrong about schema
        try {
            const resResearch = await client.query('DELETE FROM researched_companies');
            console.log(`Deleted ${resResearch.rowCount} researched_companies (memory).`);
        } catch (e) {
            console.log("researched_companies table might not exist or error:", e.message);
        }

        // 4. Clear Agent Results (Logs)
        const resAgent = await client.query('DELETE FROM agent_results');
        console.log(`Deleted ${resAgent.rowCount} agent feedback results.`);

        // 5. Clear Workflow Runs? (Optional, maybe keep for stats history, but if we want clean slate...)
        // Transforming to not delete runs so we keep cost history, but maybe marking them?
        // Let's leave run history alone for now, it's just meta-data.

        console.log("--- DATA CLEARED SUCCESSFULLY ---");

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

clearData();
