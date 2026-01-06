/**
 * CLEANUP & REPAIR SCRIPT
 * 
 * 1. Disqualifies irrelevant non-RE/Investment companies.
 * 2. Standardizes scores for known major firms.
 * 3. Prunes data artifacts.
 */

import { query } from './db/index.js';

const IRRELEVANT_KEYWORDS = [
    'whiskey', 'medicare', 'spa', 'electronics', 'shipcarte', 'chrysalabs', 'cubios', 'wowcube',
    'fleet', 'skin deep', 'tactical', 'salon', 'medical', 'fitness', 'restaurant'
];

const MAJOR_FIRMS = {
    'Brookfield': 9,
    'Hines': 9,
    'Minto': 8,
    'Dream': 8,
    'Centurion': 9,
    'Hazleview': 10,
    'Hazelview': 10,
    'Trez Capital': 9,
    'Fengate': 9,
    'TMX': 8,
    'Sagard': 9,
    'Capreit': 9,
    'Avenue Living': 9,
    'Triovest': 9,
    'Hazelview': 10
};

async function main() {
    console.log('🧹 Starting Final Cleanup & Repair...\n');

    try {
        // 1. Disqualify Irrelevant Companies
        for (const kw of IRRELEVANT_KEYWORDS) {
            const res = await query(`
                UPDATE leads 
                SET status = 'DISQUALIFIED', 
                    custom_data = jsonb_set(custom_data, '{disqualification_reason}', '"Irrelevant industry (Non-RE/Investment)"')
                WHERE (company_name ILIKE $1 OR custom_data::text ILIKE $1)
                AND status != 'DISQUALIFIED'
            `, [`%${kw}%`]);
            if (res.rowCount > 0) console.log(`🚫 Disqualified ${res.rowCount} records matching "${kw}"`);
        }

        // 2. Fix Scores for Major Firms
        for (const [name, score] of Object.entries(MAJOR_FIRMS)) {
            const res = await query(`
                UPDATE leads 
                SET custom_data = jsonb_set(custom_data, '{fit_score}', $1::jsonb)
                WHERE company_name ILIKE $2 
                AND status != 'DISQUALIFIED'
            `, [JSON.stringify(score), `%${name}%`]);
            if (res.rowCount > 0) console.log(`✅ Standardized score ${score} for ${name} (${res.rowCount} records)`);
        }

        // 3. Final Verification: Check for companies with leads but NO profile
        const { rows: missingProfiles } = await query(`
            SELECT company_name, count(*) as leads
            FROM leads
            WHERE status != 'DISQUALIFIED'
            AND (custom_data->>'company_profile' IS NULL OR length(custom_data->>'company_profile') < 100)
            GROUP BY company_name
            HAVING count(*) >= 1
        `);

        if (missingProfiles.length > 0) {
            console.log(`\n⚠️ Found ${missingProfiles.length} companies missing full profiles:`);
            missingProfiles.forEach(p => console.log(`  - ${p.company_name} (${p.leads} leads)`));
        }

    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        process.exit();
    }
}

main();
