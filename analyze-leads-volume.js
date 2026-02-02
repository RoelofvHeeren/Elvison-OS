
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

async function analyzeLeads() {
    try {
        await client.connect();

        // 1. Total Leads
        const totalRes = await client.query('SELECT COUNT(*) FROM leads');
        const total = parseInt(totalRes.rows[0].count);

        // 2. Leads by Status
        const statusRes = await client.query('SELECT status, COUNT(*) FROM leads GROUP BY status');

        // 3. Leads with Empty/Short Profiles
        const emptyProfileRes = await client.query(`
            SELECT COUNT(*) 
            FROM leads 
            WHERE company_profile IS NULL OR LENGTH(company_profile) < 100
        `);
        const emptyProfiles = parseInt(emptyProfileRes.rows[0].count);

        // 4. Leads by Date (recency)
        const recencyRes = await client.query(`
            SELECT DATE(created_at) as date, COUNT(*) 
            FROM leads 
            GROUP BY DATE(created_at) 
            ORDER BY DATE(created_at) DESC 
            LIMIT 5
        `);

        console.log(`\n--- LEADS ANALYSIS ---`);
        console.log(`Total Leads: ${total}`);
        console.log(`Empty/Scant Profiles: ${emptyProfiles} (${((emptyProfiles / total) * 100).toFixed(1)}%)`);

        console.log(`\n--- BY STATUS ---`);
        statusRes.rows.forEach(r => console.log(`${r.status}: ${r.count}`));

        console.log(`\n--- RECENT VOLUME ---`);
        recencyRes.rows.forEach(r => console.log(`${r.date.toISOString().split('T')[0]}: ${r.count}`));

    } catch (err) {
        console.error("Database error:", err);
    } finally {
        await client.end();
    }
}

analyzeLeads();
