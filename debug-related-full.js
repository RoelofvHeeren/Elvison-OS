
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

async function checkRelatedCompaniesFull() {
    try {
        await client.connect();

        const res = await client.query(`
            SELECT *
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
        console.log(`ID: ${lead.id}`);
        console.log(`Root 'company_profile' length: ${lead.company_profile ? lead.company_profile.length : 0}`);

        if (lead.custom_data) {
            console.log(`\n--- Custom Data ---`);
            const cd = lead.custom_data;
            console.log(`custom_data.company_profile length: ${cd.company_profile ? cd.company_profile.length : 0}`);
            console.log(`custom_data.company_profile_text length: ${cd.company_profile_text ? cd.company_profile_text.length : 0}`);

            if (cd.company_profile) {
                console.log(`\nPreview of custom_data.company_profile:\n${cd.company_profile.substring(0, 500)}...`);
            }
        }

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

checkRelatedCompaniesFull();
