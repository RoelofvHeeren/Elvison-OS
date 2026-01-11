
import 'dotenv/config';
import { query, getClient } from './db/index.js';

async function debugCompanies() {
    try {
        console.log('--- DEBUG START ---');

        // 1. Check total count
        const countRes = await query('SELECT COUNT(*) FROM companies');
        console.log('Total Companies:', countRes.rows[0].count);

        // 2. Check a few raw rows
        const sampleRes = await query('SELECT id, company_name, user_id, created_at FROM companies LIMIT 5');
        console.log('Sample Companies:', sampleRes.rows);

        // 3. Check for specific "Unknown" companies
        const unknownRes = await query("SELECT COUNT(*) FROM companies WHERE company_name = 'Unknown'");
        console.log('Count of "Unknown" companies:', unknownRes.rows[0].count);

        // 4. Test the API Query Logic (Simplified)
        // We need a valid user_id to test the WHERE clause. 
        // Let's grab the user_id from the first sample company if it exists.
        if (sampleRes.rows.length > 0) {
            const userId = sampleRes.rows[0].user_id;
            console.log(`Testing API Query for User ID: ${userId}`);

            const apiQuery = `
                SELECT 
                    c.id,
                    c.company_name,
                    CAST(COUNT(l.id) AS INTEGER) as lead_count,
                    MAX(l.custom_data->>'score') as fit_score,
                    MAX(l.icp_id) as icp_id
                FROM companies c
                LEFT JOIN leads l ON c.company_name = l.company_name AND c.user_id = l.user_id
                WHERE c.user_id = $1
                AND c.company_name != 'Unknown'
                GROUP BY c.id
                ORDER BY c.created_at DESC
                LIMIT 5
            `;

            try {
                const apiRes = await query(apiQuery, [userId]);
                console.log('API Query Result Count:', apiRes.rows.length);
                console.log('API Query Sample Row:', apiRes.rows[0]);
            } catch (err) {
                console.error('API Query FAILED:', err.message);
            }
        } else {
            console.log('No companies found, skipping API query test.');
        }

        console.log('--- DEBUG END ---');
    } catch (e) {
        console.error('Debug script error:', e);
    } finally {
        process.exit();
    }
}

debugCompanies();
