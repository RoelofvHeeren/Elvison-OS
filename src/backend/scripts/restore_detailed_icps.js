import { pool, query } from '../../../db/index.js';
import { generateFOQuerySet } from '../icps/familyOffice.queryBank.js';

// --- HELPER FOR INVESTMENT FIRM EXCLUSIONS (SIMILAR TO FO QUERY BANK) ---
function buildInvestmentFirmQuery(basePattern, geography = '', exclusions = []) {
    const defaultExclusions = [
        '-residential',
        '-brokerage',
        '-realtor',
        '-lender',
        '-"property management"'
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

    // Core Institutional Terms
    queries.push(buildInvestmentFirmQuery('"private equity real estate"', geography));
    queries.push(buildInvestmentFirmQuery('"real estate investment firm"', geography));
    queries.push(buildInvestmentFirmQuery('"institutional investor" real estate', geography));
    queries.push(buildInvestmentFirmQuery('"real estate fund" LP', geography));

    // Specific Investor Types
    queries.push(buildInvestmentFirmQuery('"pension fund" real estate investment', geography));
    queries.push(buildInvestmentFirmQuery('"endowment" real estate capital', geography));
    queries.push(buildInvestmentFirmQuery('"asset manager" real estate development', geography));

    // Deal & Structure Terms
    queries.push(buildInvestmentFirmQuery('"joint venture" real estate equity', geography));
    queries.push(buildInvestmentFirmQuery('"equity partner" real estate development', geography));
    queries.push(buildInvestmentFirmQuery('"value add" real estate fund', geography));
    queries.push(buildInvestmentFirmQuery('"opportunistic" real estate fund', geography));

    return queries;
}

// -------------------------------------------------------------------------

async function restoreIcps() {
    try {
        console.log('Starting ICP restoration with DYNAMIC LOGIC...');

        // 1. Get User ID
        const userRes = await query('SELECT id FROM users LIMIT 1');
        let userId = null;

        if (userRes.rows.length > 0) {
            userId = userRes.rows[0].id;
        } else {
            const icpUserRes = await query('SELECT user_id FROM icps LIMIT 1');
            if (icpUserRes.rows.length > 0) {
                userId = icpUserRes.rows[0].user_id;
            }
        }

        if (!userId) {
            console.error('❌ Could not find a valid user_id. Aborting.');
            process.exit(1);
        }
        console.log(`Using User ID: ${userId}`);

        // 2. Prepare FAMILY OFFICE Data (Powered by Query Bank)
        console.log('Generating Dynamic Family Office terms...');
        const foTermsRaw = [
            ...generateFOQuerySet('Canada'),
            ...generateFOQuerySet('North America') // Add broader scope
        ];

        // Filter duplicates
        const foTermsUnique = [...new Set(foTermsRaw)];

        const FAMILY_OFFICE_ICP = {
            name: "Family Office",
            description: "Single and Multi-Family Offices with direct real estate investment mandates in Canada or North America.",
            search_terms: foTermsUnique.map(t => ({ term: t, last_used_at: null, uses: 0 })),
            config: {
                icp_description: "Private family offices (SFO/MFO) that deploy LP equity into real estate development projects. Must have direct investment capabilities. Exclude pure wealth managers/advisors.",
                exclude_keywords: [
                    "wealth management", "financial planning", "investment advisor", "broker",
                    "realtor", "residential agent", "insurance", "mutual fund", "etf",
                    "consulting", "service provider"
                ],
                target_industries: ["Real Estate", "Investment Management", "Venture Capital & Private Equity"],
                target_locations: ["Canada", "United States", "North America"],
                surveys: {
                    company_finder: {
                        icp_description: "Private family offices (SFO/MFO) that deploy LP equity into real estate development projects.",
                        geography: ["Canada", "United States"],
                        org_types: ["Family Office", "Private Investment Firm"]
                    },
                    research_framework: {
                        search_keywords: "single family office, multi family office, private investment office, family capital"
                    },
                    apollo_lead_finder: {
                        job_titles: ["Chief Investment Officer", "CIO", "Principal", "Managing Partner", "Head of Real Estate", "Director of Investments", "President", "Founder"],
                        seniority: ["c_level", "partner", "vp", "director"],
                        job_functions: ["business_development", "finance", "operations"],
                        max_contacts: 3
                    }
                }
            }
        };

        // 3. Prepare INVESTMENT FIRM Data (Powered by new IF Logic)
        console.log('Generating Dynamic Investment Firm terms...');
        const ifTermsRaw = [
            ...generateIFQuerySet('Canada'),
            ...generateIFQuerySet('US')
        ];

        // Filter duplicates
        const ifTermsUnique = [...new Set(ifTermsRaw)];

        const INVESTMENT_FIRM_ICP = {
            name: "Investment Firm",
            description: "Private Equity Funds, Asset Managers, and Institutional Investors deploying LP equity into real estate development.",
            search_terms: ifTermsUnique.map(t => ({ term: t, last_used_at: null, uses: 0 })),
            config: {
                icp_description: "Institutional investment firms (PE, Pension, Endowment, Asset Manager) that act as LP equity partners for real estate developers.",
                exclude_keywords: [
                    "residential brokerage", "property management only", "lender only", "mortgage broker",
                    "consulting", "service provider", "commercial agent"
                ],
                target_industries: ["Real Estate", "Investment Management", "Financial Services"],
                target_locations: ["Canada", "United States"],
                surveys: {
                    company_finder: {
                        icp_description: "Institutional investment firms (PE, Pension, Endowment, Asset Manager) that act as LP equity partners for real estate developers.",
                        geography: ["Canada", "United States"],
                        org_types: ["Private Equity", "Asset Management", "Pension Fund", "Endowment"]
                    },
                    research_framework: {
                        search_keywords: "private equity real estate, institutional investor, real estate fund"
                    },
                    apollo_lead_finder: {
                        job_titles: ["Director of Acquisitions", "VP Development", "Partner", "Head of Capital", "Investment Director", "Managing Director", "VP Investments"],
                        seniority: ["c_level", "partner", "vp", "director"],
                        job_functions: ["business_development", "finance"],
                        max_contacts: 3
                    }
                }
            }
        };

        // 4. Update Database
        await upsertIcp(userId, FAMILY_OFFICE_ICP);
        await upsertIcp(userId, INVESTMENT_FIRM_ICP);

        console.log('✅ ICP restoration complete with DYNAMIC QUERY LOGIC.');
        process.exit(0);

    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

async function upsertIcp(userId, icpData) {
    console.log(`Processing ICP: ${icpData.name}...`);
    console.log(`   Terms generated: ${icpData.search_terms.length}`);

    // Check if exists
    const existing = await query(
        'SELECT id FROM icps WHERE user_id = $1 AND name = $2',
        [userId, icpData.name]
    );

    if (existing.rows.length > 0) {
        const id = existing.rows[0].id;
        console.log(`  Updating existing ICP (ID: ${id})...`);

        await query(
            `UPDATE icps 
             SET search_terms = $1::jsonb, 
                 config = $2::jsonb, 
                 updated_at = NOW() 
             WHERE id = $3`,
            [JSON.stringify(icpData.search_terms), JSON.stringify(icpData.config), id]
        );
        console.log(`  ✅ Updated.`);
    } else {
        console.log(`  Creating new ICP...`);

        await query(
            `INSERT INTO icps (user_id, name, search_terms, config, created_at, updated_at)
             VALUES ($1, $2, $3::jsonb, $4::jsonb, NOW(), NOW())`,
            [userId, icpData.name, JSON.stringify(icpData.search_terms), JSON.stringify(icpData.config)]
        );
        console.log(`  ✅ Created.`);
    }
}

restoreIcps();
