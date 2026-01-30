
import { pool, query } from '../../../db/index.js';
import { generateFOQuerySet } from '../icps/familyOffice.queryBank.js';

// --- HELPER FOR INVESTMENT FIRM EXCLUSIONS ---
function buildInvestmentFirmQuery(basePattern, geography = '', exclusions = []) {
    const defaultExclusions = [
        '-brokerage',
        '-"property management"',
        '-lender',
        '-"mortgage broker"',
        '-consulting',
        '-"service provider"',
        '-"commercial real estate agent"',
        '-residential',
        '-"wealth management"',
        '-advisor'
    ];

    const allExclusions = [...defaultExclusions, ...exclusions];
    const exclusionStr = allExclusions.join(' ');

    let query = basePattern;
    if (geography) {
        query += ` ${geography}`;
    }
    query += ` ${exclusionStr}`;

    return query.trim();
}

function generateIFQuerySet(geography = 'Canada') {
    const queries = [];
    queries.push(buildInvestmentFirmQuery('"private equity real estate"', geography));
    queries.push(buildInvestmentFirmQuery('"real estate investment firm"', geography));
    queries.push(buildInvestmentFirmQuery('"institutional investor" real estate', geography));
    queries.push(buildInvestmentFirmQuery('"real estate fund" LP', geography));
    queries.push(buildInvestmentFirmQuery('"pension fund" real estate investment', geography));
    queries.push(buildInvestmentFirmQuery('"endowment" real estate capital', geography));
    queries.push(buildInvestmentFirmQuery('"asset manager" real estate development', geography));
    queries.push(buildInvestmentFirmQuery('"joint venture" real estate equity', geography));
    queries.push(buildInvestmentFirmQuery('"equity partner" real estate development', geography));
    queries.push(buildInvestmentFirmQuery('"value add" real estate fund', geography));
    queries.push(buildInvestmentFirmQuery('"opportunistic" real estate fund', geography));
    return queries;
}
// ---------------------------------------------------

async function finalCleanAndRestore() {
    try {
        console.log('🚀 Starting Final Cleanup & Restoration...');

        // 1. DELETE EXTRA USERS
        const targetEmail = 'roelof@elvison.com';
        console.log(`\n👥 Removing all users EXCEPT: ${targetEmail}...`);

        // Find target user
        const targetUserRes = await query('SELECT id FROM users WHERE email = $1', [targetEmail]);
        if (targetUserRes.rows.length === 0) {
            console.error(`❌ CRITICAL: Target user ${targetEmail} NOT FOUND! Aborting to prevent total data loss.`);
            process.exit(1);
        }
        const targetUserId = targetUserRes.rows[0].id;
        console.log(`   -> Target User ID: ${targetUserId}`);

        // 2. TRUNCATE DATA (Do this first to be safe)
        console.log('\n🧹 Desolating Companies and Leads...');
        await query('TRUNCATE TABLE leads CASCADE');
        await query('TRUNCATE TABLE companies CASCADE');
        console.log('   ✅ Tables truncated.');

        // 3. REMOVE EXTRA USERS (Handle FKs first)
        console.log(`\n👥 Removing all users EXCEPT: ${targetEmail}...`);

        // Delete ICPs for non-target users
        const deletedIcps = await query('DELETE FROM icps WHERE user_id != $1', [targetUserId]);
        console.log(`   ✅ Removed ${deletedIcps.rowCount} orphan ICPs.`);

        // Delete other users
        const deleteRes = await query('DELETE FROM users WHERE id != $1', [targetUserId]);
        console.log(`   ✅ Removed ${deleteRes.rowCount} other users.`);

        // 3. RESTORE ICPS (Only for target user)
        console.log('\n💎 Restoring Dynamic ICPs for Roelof...');

        // Family Office
        const foTermsUnique = [...new Set([...generateFOQuerySet('Canada'), ...generateFOQuerySet('North America')])];
        const FAMILY_OFFICE_ICP = {
            name: "Family Office",
            description: "Single and Multi-Family Offices with direct real estate investment mandates in Canada or North America.",
            search_terms: foTermsUnique.map(t => ({ term: t, last_used_at: null, uses: 0 })),
            config: {
                icp_description: "Private family offices (SFO/MFO) that deploy LP equity into real estate development projects.",
                exclude_keywords: ["wealth management", "financial planning", "investment advisor", "broker", "realtor", "residential agent", "consulting"],
                target_locations: ["Canada", "United States"],
                surveys: {
                    company_finder: { geography: ["Canada", "United States"], org_types: ["Family Office"] },
                    apollo_lead_finder: { job_titles: ["Chief Investment Officer", "CIO", "Principal", "Managing Partner"], max_contacts: 3 }
                }
            }
        };

        // Investment Firm
        const ifTermsUnique = [...new Set([...generateIFQuerySet('Canada'), ...generateIFQuerySet('US')])];
        const INVESTMENT_FIRM_ICP = {
            name: "Investment Firm",
            description: "Private Equity Funds, Asset Managers, and Institutional Investors deploying LP equity into real estate development.",
            search_terms: ifTermsUnique.map(t => ({ term: t, last_used_at: null, uses: 0 })),
            config: {
                icp_description: "Institutional investment firms (PE, Pension, Endowment, Asset Manager) that act as LP equity partners.",
                exclude_keywords: ["residential brokerage", "property management only", "lender only", "consulting"],
                target_locations: ["Canada", "United States"],
                surveys: {
                    company_finder: { geography: ["Canada", "United States"], org_types: ["Private Equity", "Asset Management"] },
                    apollo_lead_finder: { job_titles: ["Director of Acquisitions", "VP Development", "Partner"], max_contacts: 3 }
                }
            }
        };

        await upsertIcp(targetUserId, FAMILY_OFFICE_ICP);
        await upsertIcp(targetUserId, INVESTMENT_FIRM_ICP);

        console.log('\n✅ FINAL RESTORATION COMPLETE. Only Roelof remains. Data is clean. ICPs are set.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

async function upsertIcp(userId, icpData) {
    const existing = await query(
        'SELECT id FROM icps WHERE user_id = $1 AND name = $2',
        [userId, icpData.name]
    );

    if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        await query(
            `UPDATE icps 
             SET search_terms = $1::jsonb, 
                 config = $2::jsonb, 
                 updated_at = NOW() 
             WHERE id = $3`,
            [JSON.stringify(icpData.search_terms), JSON.stringify(icpData.config), id]
        );
        console.log(`      Updated ICP: ${icpData.name}`);
    } else {
        await query(
            `INSERT INTO icps (user_id, name, search_terms, config, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())`,
            [userId, icpData.name, JSON.stringify(icpData.search_terms), JSON.stringify(icpData.config)]
        );
        console.log(`      Created ICP: ${icpData.name}`);
    }
}

finalCleanAndRestore();
