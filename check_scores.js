/**
 * Check Company Scores & Profiles
 * 
 * Fetches and displays a summary of all enriched companies to verify scoring.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        const result = await pool.query(`
            SELECT 
                company_name, 
                custom_data->>'fit_score' as score,
                custom_data->>'fit_reason' as reason,
                custom_data->>'company_profile' as profile,
                custom_data->>'investor_type' as type
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            AND custom_data->>'company_profile' IS NOT NULL
            ORDER BY (custom_data->>'fit_score')::int DESC, company_name ASC
        `);

        console.log(`📊 Found ${result.rows.length} enriched companies\n`);

        console.log(`| Score | Company | Type | Profile Summary |`);
        console.log(`|---|---|---|---|`);

        result.rows.forEach(r => {
            const profileSnippet = r.profile ? r.profile.substring(0, 100).replace(/\n/g, ' ') + '...' : 'No profile';
            const reasonSnippet = r.reason ? r.reason.substring(0, 100).replace(/\n/g, ' ') + '...' : '';
            console.log(`| ${r.score}/10 | **${r.company_name}** | ${r.type || 'N/A'} | ${profileSnippet} <br> *Reason: ${reasonSnippet}* |`);
        });

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
