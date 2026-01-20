
import dotenv from 'dotenv';
import { query } from './db/index.js';

dotenv.config();

const USER_EMAIL = 'roelof@elvison.com';

async function fixFinalLeads() {
    try {
        console.log('🔧 Starting Final Lead Fix...');

        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        // 1. Delete Verified Duplicates
        // These are companies where we have a "better" version with leads (e.g. "Goldman Sachs" vs "GS ASSET...")
        const duplicatesToDelete = [
            'GS ASSET MANAGEMENT LTD',
            'Gs Financial Services Corp',
            'WePay', // Covered by J.P. Morgan
            'Boardwalk Real Estate Investment Trust' // Covered by 'Boardwalk' (11 leads)
        ];

        for (const name of duplicatesToDelete) {
            const delRes = await query(`
                DELETE FROM companies 
                WHERE user_id = $1 AND company_name = $2
            `, [userId, name]);
            if (delRes.rowCount > 0) {
                console.log(`🗑️  Deleted duplicate company: ${name}`);
            }
        }

        // 2. Fix Linking for Valid Companies
        // These companies exist but have 0 links, even though leads likely exist in the DB.
        const companiesToFix = [
            { name: 'Brookfield Asset Management', pattern: '%Brookfield%' },
            { name: 'Choice Properties REIT', pattern: '%Choice Properties%' },
            { name: 'Canada Lands Company', pattern: '%Canada Lands%' },
            { name: 'Middlefield', pattern: '%Middlefield%' }
        ];

        for (const co of companiesToFix) {
            // Find the company ID
            const coRes = await query(`SELECT id FROM companies WHERE company_name = $1 AND user_id = $2`, [co.name, userId]);

            if (coRes.rows.length === 0) {
                console.log(`⚠️  Could not find company table record for: ${co.name}`);
                continue;
            }
            const companyId = coRes.rows[0].id;

            // Find matching leads (that might not be linked yet)
            const leadsRes = await query(`
                SELECT id, person_name FROM leads 
                WHERE company_name ILIKE $1
            `, [co.pattern]);

            console.log(`🔍 Found ${leadsRes.rowCount} potential leads for ${co.name} (Pattern: ${co.pattern})`);

            let linkCount = 0;
            for (const lead of leadsRes.rows) {
                // Link it!
                try {
                    await query(`
                        INSERT INTO leads_link (lead_id, parent_id, parent_type)
                        VALUES ($1, $2, 'user')
                        ON CONFLICT (lead_id, parent_id, parent_type) DO NOTHING
                    `, [lead.id, userId]);
                    linkCount++;
                } catch (e) {
                    // Ignore conflicts
                }
            }
            console.log(`   🔗 Linked ${linkCount} leads to User/Company.`);
        }

        // 3. Final Check
        const remainingZero = await query(`
            SELECT company_name 
            FROM companies c 
            WHERE user_id = $1
            AND (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE (l.company_name = c.company_name OR l.company_name ILIKE ('%' || c.company_name || '%'))
                AND link.parent_id = c.user_id
            ) = 0
        `, [userId]);

        console.log(`\n📉 Remaining Zero-Lead Companies: ${remainingZero.rowCount}`);
        remainingZero.rows.forEach(r => console.log(`   - ${r.company_name}`));

        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

fixFinalLeads();
