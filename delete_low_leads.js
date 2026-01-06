/**
 * Delete Low Quality Leads & Verify Remaining
 * 
 * 1. Deletes all leads with fit_score < 6
 * 2. Counts remaining leads
 * 3. Shows one full profile for verification
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
        console.log('🗑️  Deleting companies with score < 6...');
        const deleteRes = await pool.query(`
            DELETE FROM leads 
            WHERE (custom_data->>'fit_score')::int < 6
        `);
        console.log(`✅ Deleted ${deleteRes.rowCount} low-quality companies.\n`);

        const result = await pool.query(`
            SELECT 
                company_name, 
                custom_data->>'fit_score' as score,
                custom_data->>'company_profile' as profile
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            ORDER BY (custom_data->>'fit_score')::int DESC, company_name ASC
        `);

        console.log(`📊 REMAINING COMPANIES: ${result.rows.length}`);

        console.log(`\n📋 List of GOOD companies (>6/10):`);
        result.rows.forEach(r => {
            console.log(` - ${r.company_name} (${r.score}/10)`);
        });

        if (result.rows.length > 0) {
            console.log(`\n📄 EXAMPLE FULL PROFILE (${result.rows[0].company_name}):`);
            console.log('--------------------------------------------------');
            console.log(result.rows[0].profile);
            console.log('--------------------------------------------------');
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
