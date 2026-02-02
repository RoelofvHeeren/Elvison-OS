
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

async function checkRelatedCompanies() {
    try {
        await client.connect();

        // Search for the company
        const res = await client.query(`
            SELECT id, company_name, company_website, company_profile, research_fact, source_notes, outreach_status
            FROM leads
            WHERE company_name ILIKE '%Related Companies%'
            LIMIT 1
        `);

        if (res.rows.length === 0) {
            console.log("No lead found for 'Related Companies'");
            return;
        }

        const lead = res.rows[0];
        console.log(`--- Lead Found: ${lead.company_name} ---`);
        console.log(`Website: ${lead.company_website}`);
        console.log(`Research Fact: "${lead.research_fact}"`);
        console.log(`Outreach Status: ${lead.outreach_status}`);
        console.log(`\n--- Company Profile (First 1500 chars) ---`);
        console.log((lead.company_profile || '').substring(0, 1500));
        console.log(`\n--- Company Profile (Last 500 chars) ---`);
        console.log((lead.company_profile || '').slice(-500));

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

checkRelatedCompanies();
