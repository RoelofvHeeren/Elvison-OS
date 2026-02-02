
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

async function checkRawData() {
    try {
        await client.connect();

        const res = await client.query(`
            SELECT id, company_name, source_notes, custom_data
            FROM leads
            WHERE company_name ILIKE '%Related Companies%'
            LIMIT 1
        `);

        if (res.rows.length === 0) {
            console.log("No lead found for 'Related Companies'");
            return;
        }

        const lead = res.rows[0];
        console.log(`--- Lead: ${lead.company_name} ---`);

        // Check source_notes
        console.log(`source_notes length: ${lead.source_notes ? lead.source_notes.length : 0}`);
        if (lead.source_notes) console.log(`source_notes preview: ${lead.source_notes.substring(0, 50)}...`);

        // Check custom_data keys
        const keys = Object.keys(lead.custom_data || {});
        console.log(`custom_data keys: ${keys.join(', ')}`);

        // Check for likely raw content keys
        const rawKeys = ['scraped_content', 'raw_text', 'website_text', 'full_scrape'];
        for (const k of rawKeys) {
            if (lead.custom_data[k]) {
                console.log(`Found possible raw content in '${k}': Length ${lead.custom_data[k].length}`);
            }
        }

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

checkRawData();
