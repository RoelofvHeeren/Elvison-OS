
import dotenv from 'dotenv';
import { query } from './db/index.js';

dotenv.config();

const USER_EMAIL = 'roelof@elvison.com';

async function debugCompanyNames() {
    try {
        console.log('🕵️‍♀️ Diagnosing Name Mismatches...');

        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        // 1. Get companies with 0 leads (according to strict matching)
        const zeroLeadCompanies = await query(`
            SELECT c.company_name 
            FROM companies c
            WHERE c.user_id = $1
            AND (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id
            ) = 0
            ORDER BY c.company_name
        `, [userId]);

        console.log(`Found ${zeroLeadCompanies.rowCount} zero-lead companies.`);

        for (const company of zeroLeadCompanies.rows) {
            const name = company.company_name;

            // Search for leads with SIMILAR names
            const similarLeads = await query(`
                SELECT DISTINCT company_name, COUNT(*) as count 
                FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE link.parent_id = $1
                AND l.company_name ILIKE $2
                AND l.company_name != $3
                GROUP BY company_name
            `, [userId, `%${name.split(' ')[0]}%`, name]); // Search by first word likeness

            if (similarLeads.rowCount > 0) {
                console.log(`\n❌ MISMATCH: "${name}" has 0 leads, but found potential matches:`);
                similarLeads.rows.forEach(l => console.log(`   - "${l.company_name}" (${l.count} leads)`));
            } else {
                // Try looser search?
                console.log(`\n⚠️  "${name}" has 0 leads and NO obvious similar names found.`);
            }
        }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

debugCompanyNames();
