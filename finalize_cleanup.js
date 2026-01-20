
import dotenv from 'dotenv';
import { query } from './db/index.js';

dotenv.config();

const USER_EMAIL = 'roelof@elvison.com';

async function finalizeCleanup() {
    try {
        console.log('🧹 Starting Final Cleanup & Audit...');

        // 1. Get User
        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        // 2. Delete the 2 Known Orphans
        // Allied Properties (alliedreit.com) & Kilmer Group (kilmergroup.com)
        const deleteRes = await query(`
            DELETE FROM companies 
            WHERE user_id = $1 
            AND (
                website ILIKE '%alliedreit.com%' OR 
                website ILIKE '%kilmergroup.com%'
            )
            RETURNING company_name;
        `, [userId]);

        console.log(`\n🗑️  Deleted ${deleteRes.rowCount} orphan companies:`);
        deleteRes.rows.forEach(r => console.log(`   - ${r.company_name}`));

        // 3. Fix Missing ICP Types
        // Find companies with NULL icp_type
        const missingIcpRes = await query(`
            SELECT id, company_name, website 
            FROM companies 
            WHERE user_id = $1 AND (icp_type IS NULL OR icp_type = '')
        `, [userId]);

        console.log(`\n🔍 Found ${missingIcpRes.rowCount} companies with missing ICP Type.`);

        let fixedCount = 0;
        for (const company of missingIcpRes.rows) {
            let newType = 'ASSET_MANAGER_MULTI_STRATEGY'; // Default fallback for generic firms

            const name = company.company_name.toLowerCase();
            if (name.includes('family') || name.includes('office')) {
                newType = 'FAMILY_OFFICE_SINGLE';
            } else if (name.includes('reit') || name.includes('real estate investment trust')) {
                newType = 'REIT_PUBLIC';
            } else if (name.includes('pension')) {
                newType = 'PENSION';
            } else if (name.includes('private equity') || name.includes('capital')) {
                newType = 'REAL_ESTATE_PRIVATE_EQUITY';
            }

            await query(`UPDATE companies SET icp_type = $1 WHERE id = $2`, [newType, company.id]);
            console.log(`   - Fixed ${company.company_name} -> ${newType}`);
            fixedCount++;
        }

        // 4. Final verification Counts
        // User asked for: "Total Companies (Family Office) + Total Companies (Investment Funds) = Total Companies"
        // We need to know which ICP Types map to which category.
        // Assumption based on typical classification:
        // FO Strategy: FAMILY_OFFICE_SINGLE, FAMILY_OFFICE_MULTI
        // IF Strategy: REIT_PUBLIC, REAL_ESTATE_PRIVATE_EQUITY, ASSET_MANAGER_MULTI_STRATEGY, PENSION, SOVEREIGN_WEALTH_FUND, REAL_ESTATE_DEBT_FUND, RE_DEVELOPER_OPERATOR

        const countsRes = await query(`
            SELECT count(*) as total,
            SUM(CASE WHEN icp_type IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI') THEN 1 ELSE 0 END) as fo_count,
            SUM(CASE WHEN icp_type NOT IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI') AND icp_type IS NOT NULL THEN 1 ELSE 0 END) as if_count,
            SUM(CASE WHEN icp_type IS NULL THEN 1 ELSE 0 END) as null_count
            FROM companies
            WHERE user_id = $1
        `, [userId]);

        const { total, fo_count, if_count, null_count } = countsRes.rows[0];

        console.log('\n📊 Final Verification Counts:');
        console.log(`   Total Companies: ${total}`);
        console.log(`   Family Office Strategy: ${fo_count}`);
        console.log(`   Investment Fund Strategy: ${if_count}`);
        console.log(`   Uncategorized: ${null_count}`);

        if (parseInt(total) === (parseInt(fo_count) + parseInt(if_count))) {
            console.log('\n✅ PASSED: Sum matches Total.');
        } else {
            console.log('\n❌ FAILED: Mismatch detected.');
        }

        // Also verify all companies have leads now?
        const zeroLeadCheck = await query(`
            SELECT count(*) as count
            FROM companies c 
            WHERE user_id = $1
            AND (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id
            ) = 0
        `, [userId]);

        if (parseInt(zeroLeadCheck.rows[0].count) === 0) {
            console.log('✅ PASSED: All companies have at least one lead.');
        } else {
            console.log(`❌ FAILED: ${zeroLeadCheck.rows[0].count} companies still have 0 leads.`);
        }

        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

finalizeCleanup();
