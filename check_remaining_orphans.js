
import dotenv from 'dotenv';
import { query } from './db/index.js';

dotenv.config();

async function findRemainingOrphans() {
    try {
        const userRes = await query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        const userId = userRes.rows[0].id;

        // Fetch companies that STILL have 0 leads after the strict search
        // We look for companies created/audited recently (or just all valid orphans)
        const companiesRes = await query(`
            SELECT c.company_name, c.website,
            (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id
                AND link.parent_type = 'user'
            ) as actual_lead_count
            FROM companies c 
            WHERE user_id = $1
        `, [userId]);

        const remainingOrphans = companiesRes.rows.filter(c =>
            parseInt(c.actual_lead_count) === 0 &&
            c.website &&
            c.website.trim() !== ''
        );

        console.log(`Found ${remainingOrphans.length} remaining orphan companies.`);
        console.log('---');
        remainingOrphans.forEach(c => console.log(`- ${c.company_name} (${c.website})`));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

findRemainingOrphans();
