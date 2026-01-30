
import { query } from '../../../db/index.js';
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

async function optimizeIcps() {
    try {
        console.log('🚀 Optimizing ICPs for Roelof...');
        const email = 'roelof@elvison.com';

        const userRes = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            console.error('❌ User found. Run reset script first.');
            process.exit(1);
        }
        const userId = userRes.rows[0].id;

        // --- 1. FAMILY OFFICE CONFIG ---
        const foTermsUnique = [...new Set([...generateFOQuerySet('Canada'), ...generateFOQuerySet('United States')])];
        const FAMILY_OFFICE_CONFIG = {
            surveys: {
                company_finder: {
                    icp_description: "We target Single Family Offices (SFO) and Multi-Family Offices (MFO) in Canada and the United States that actively deploy capital into direct real estate investments. They should have a mandate for LP equity checks between $5M and $50M and be open to joint venture partnerships with experienced developers.",
                    strictness: "Strict - Only exact ICP matches (e.g., only real estate investment firms, no adjacent industries)",
                    org_types: ["Family Office", "Private Equity / Venture Capital"],
                    excluded_industries: "Wealth Management, Financial Planning, Investment Advisory (RIAs), Insurance, Residential Real Estate Brokerage, Consulting",
                    geography: ["Canada", "United States"],
                    quality_bar: "AUM > $100M, Active direct investment mandate, Evidence of real estate portfolio"
                },
                company_profiler: {
                    key_attributes: "Direct Real Estate Investment Mandate, 'Principal' or 'Direct' investing focus, Mention of Joint Ventures or LP Equity",
                    red_flags: "Wealth management only, No direct investments, advisory services only, 'client focused' services (if not an investment arm)",
                    depth: "Deep Dive (News, LinkedIn, Reports)",
                    profile_content: "Assets Under Management (AUM), Investment Strategy (Value-add, Opportunistic, Core-plus), Typical Check Size, Geographic Focus, Key Decision Makers, Recent Deals or Acquisitions.",
                    manual_research: "I check the 'Investment Strategy' or 'Portfolio' page to verify they make direct equity investments in real estate projects and don't just allocate to funds or public markets."
                },
                apollo_lead_finder: {
                    seniority: ["Partner / Principal", "C-Level (CEO, CIO, COO)", "VP / Director", "Head of X"],
                    job_functions: ["Executive / Leadership", "Finance", "Operations"], // Investment often falls under Finance/Exec in Apollo
                    excluded_functions: ["Sales / Revenue", "Marketing / Growth", "HR / People", "Support / Admin", "Recruiting / Talent"],
                    job_titles: ["Chief Investment Officer", "CIO", "Principal", "Managing Partner", "Head of Real Estate", "Director of Acquisitions", "Investment Manager"],
                    max_contacts: "3"
                },
                outreach_creator: {
                    prompt_instructions: `You are Roelof van Heeren, a Principal at Fifth Avenue Properties, a Canadian residential real estate development firm.
Your goal is to write direct, fact-based outreach messages to potential Investment Partners (LPs/Co-GPs) or Peers in the industry.

CRITICAL: The user HATES generic messages. 
- NEVER use "Assets Under Management" (AUM) as the hook.
- NEVER use "Number of Offices" or "Transaction Volume" as the hook.
- NEVER mention "Sales Volume" (that sounds like a brokerage).

HARD LIMITS (CRITICAL):
- LinkedIn Message Max Length: 300 characters (Strictly enforced).
- Mention EXACTLY ONE researched fact from the company profile.
- Mention COMPANY FACTS ONLY (No personal details, no "20 years experience").
- NO FLATTERY (No "Impressive career", "Great work").
- NO BUZZWORDS (No "synergies", "unlock value", "disrupting").
- NO CALLS TO ACTION (No "hop on a call", no "meeting").
- MAXIMUM GENERALITY RULE: Prefer specific facts, but if none are found, use a general professional statement about their residential focus. DO NOT FAIL.

MANDATORY PRIORITY ORDER (Stop at the FIRST match):

1. SPECIFIC DEALS / NAMED PROJECTS (Highest Priority)
   - Fact: A specific project name, asset, or recent acquisition.
   - Alignment Line: "We frequently develop similar projects at Fifth Avenue Properties" OR "We develop similar residential projects at Fifth Avenue Properties"
   - Example: "Hi Sarah, I came across Alpine Start’s Alpine Village project in North Texas. We frequently develop similar projects at Fifth Avenue Properties and thought connecting could be worthwhile."

2. INVESTMENT THESIS / STRATEGY (Focus on ASSET CLASS)
   - Fact: Specific strategy like "ground-up multifamily", "purpose-built rental", "residential-led mixed use".
   - Alignment Line: "We work on similar residential strategies at Fifth Avenue Properties"
   - Example: "Hi Michael, I came across Morguard’s long-standing focus on multi-suite residential across North America. We work on similar residential strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

3. RESIDENTIAL FOCUS / MARKET PRESENCE
   - Fact: A clear statement of residential focus (e.g. "Owning 50,000 apartments", "Developing master-planned communities").
   - DO NOT USE AUM or GENERIC SCALE ("$5B AUM"). Use unit count or specific market presence if available.
   - Alignment Line: "We focus on similar residential markets at Fifth Avenue Properties"
   - Example: "Hi John, I noticed Choice Properties' significant portfolio of residential assets in major Canadian markets. We focus on similar residential development strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

BAD FACTS (DO NOT USE THESE):
- "Closed $700M in sales" -> REJECT (Brokerage signal).
- "45 offices worldwide" -> REJECT (Generic).
- "$4.1B AUM" -> REJECT (Unless tied to specific "residential assets").
- "Advice on vineyards" -> REJECT (Irrelevant).

LINKEDIN MESSAGE STRUCTURE (Fixed):
Sentence 1: Greeting + Researched Company Fact (e.g. "Hi [Name], I came across [Company] and [Specific Fact].")
Sentence 2: Fifth Avenue Properties alignment (Use mandatory alignment line from above) + Soft close ("and thought connecting could be worthwhile.")

EMAIL STRUCTURE:
Subject: Introduction | [Specific Asset Class/Strategy]
Body:
"Hi [Name],

I came across [Company] and your [Specific Fact used in LinkedIn msg].

At Fifth Avenue Properties, [Alignment Line used in LinkedIn msg], which is why I thought it could make sense to connect.

If it makes sense, I'm happy to share more information about our current projects.

Best regards,
Roelof van Heeren
Fifth Avenue Properties"

OUTPUT JSON:
{ "leads": [{ "email": "...", "connection_request": "...", "email_subject": "...", "email_message": "..." }] }
If no specific fact is found, craft a polite, relevant generic message about their residential investment focus. NEVER return null.`
                },
                research_framework: {
                    facts_to_mention: "Specific deal sizes, asset classes (multifamily, industrial), and geographic markets.",
                    search_keywords: "Family Office Real Estate Canada, SFO Direct Investment, Real Estate Joint Venture Partner",
                    manual_workflow: "Google 'Family Office Real Estate [City]', check website for 'Direct Investment' page, verify team size on LinkedIn."
                }
            },
            // Flat keys for backwards compatibility/indexing
            icp_description: "We target Single Family Offices (SFO) and Multi-Family Offices (MFO)...",
            exclude_keywords: ["wealth management", "financial planning", "investment advisor", "broker"],
            target_locations: ["Canada", "United States"]
        };

        // --- 2. INVESTMENT FIRM CONFIG ---
        const ifTermsUnique = [...new Set([...generateIFQuerySet('Canada'), ...generateIFQuerySet('US')])];
        const INVESTMENT_FIRM_CONFIG = {
            surveys: {
                company_finder: {
                    icp_description: "We target Canadian and US real estate investment firms (Private Equity, Pension Funds, Asset Managers) with $50M+ in assets under management, focused on residential multi-family properties. They should have an active acquisition strategy and be open to joint ventures with developers.",
                    strictness: "Strict - Only exact ICP matches (e.g., only real estate investment firms, no adjacent industries)",
                    org_types: ["Private Equity / Venture Capital", "Asset Management"],
                    excluded_industries: "Restaurants, Food & Beverage, Small retail shops, Local service businesses, Residential Brokerage, Property Management (Third Party), Lenders",
                    geography: ["Canada", "United States"],
                    quality_bar: "Revenue > $10M, AUM > $50M, Recently funded or active acquirer"
                },
                company_profiler: {
                    key_attributes: "Active blog, Buying/Acquiring, Multi-family focus, Development partner",
                    red_flags: "Competitor products, Negative reviews, No website, Third-party management only",
                    depth: "Deep Dive (News, LinkedIn, Reports)",
                    profile_content: "Assets under management, investment focus areas, recent deals, team size, geographic presence, fund structure, LP equity availability.",
                    manual_research: "I look for a Portfolio page and count assets, check the 'Team' page for acquisition roles, and read press releases for recent deal activity."
                },
                apollo_lead_finder: {
                    seniority: ["Partner / Principal", "C-Level (CEO, CIO, COO)", "VP / Director"],
                    job_functions: ["Executive / Leadership", "Finance", "Operations"],
                    excluded_functions: ["Entry Level / Interns", "Support / Admin", "Recruiting / Talent", "Students", "Sales / Revenue", "Marketing / Growth", "HR / People"],
                    job_titles: ["Director of Acquisitions", "VP Development", "Partner", "Chief Investment Officer", "Head of Real Estate"],
                    max_contacts: "3"
                },
                outreach_creator: {
                    prompt_instructions: `You are Roelof van Heeren, a Principal at Fifth Avenue Properties, a Canadian residential real estate development firm.
Your goal is to write direct, fact-based outreach messages to potential Investment Partners (LPs/Co-GPs) or Peers in the industry.

CRITICAL: The user HATES generic messages. 
- NEVER use "Assets Under Management" (AUM) as the hook.
- NEVER use "Number of Offices" or "Transaction Volume" as the hook.
- NEVER mention "Sales Volume" (that sounds like a brokerage).

HARD LIMITS (CRITICAL):
- LinkedIn Message Max Length: 300 characters (Strictly enforced).
- Mention EXACTLY ONE researched fact from the company profile.
- Mention COMPANY FACTS ONLY (No personal details, no "20 years experience").
- NO FLATTERY (No "Impressive career", "Great work").
- NO BUZZWORDS (No "synergies", "unlock value", "disrupting").
- NO CALLS TO ACTION (No "hop on a call", no "meeting").
- MAXIMUM GENERALITY RULE: Prefer specific facts, but if none are found, use a general professional statement about their residential focus. DO NOT FAIL.

MANDATORY PRIORITY ORDER (Stop at the FIRST match):

1. SPECIFIC DEALS / NAMED PROJECTS (Highest Priority)
   - Fact: A specific project name, asset, or recent acquisition.
   - Alignment Line: "We frequently develop similar projects at Fifth Avenue Properties" OR "We develop similar residential projects at Fifth Avenue Properties"
   - Example: "Hi Sarah, I came across Alpine Start’s Alpine Village project in North Texas. We frequently develop similar projects at Fifth Avenue Properties and thought connecting could be worthwhile."

2. INVESTMENT THESIS / STRATEGY (Focus on ASSET CLASS)
   - Fact: Specific strategy like "ground-up multifamily", "purpose-built rental", "residential-led mixed use".
   - Alignment Line: "We work on similar residential strategies at Fifth Avenue Properties"
   - Example: "Hi Michael, I came across Morguard’s long-standing focus on multi-suite residential across North America. We work on similar residential strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

3. RESIDENTIAL FOCUS / MARKET PRESENCE
   - Fact: A clear statement of residential focus (e.g. "Owning 50,000 apartments", "Developing master-planned communities").
   - DO NOT USE AUM or GENERIC SCALE ("$5B AUM"). Use unit count or specific market presence if available.
   - Alignment Line: "We focus on similar residential markets at Fifth Avenue Properties"
   - Example: "Hi John, I noticed Choice Properties' significant portfolio of residential assets in major Canadian markets. We focus on similar residential development strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

BAD FACTS (DO NOT USE THESE):
- "Closed $700M in sales" -> REJECT (Brokerage signal).
- "45 offices worldwide" -> REJECT (Generic).
- "$4.1B AUM" -> REJECT (Unless tied to specific "residential assets").
- "Advice on vineyards" -> REJECT (Irrelevant).

LINKEDIN MESSAGE STRUCTURE (Fixed):
Sentence 1: Greeting + Researched Company Fact (e.g. "Hi [Name], I came across [Company] and [Specific Fact].")
Sentence 2: Fifth Avenue Properties alignment (Use mandatory alignment line from above) + Soft close ("and thought connecting could be worthwhile.")

EMAIL STRUCTURE:
Subject: Introduction | [Specific Asset Class/Strategy]
Body:
"Hi [Name],

I came across [Company] and your [Specific Fact used in LinkedIn msg].

At Fifth Avenue Properties, [Alignment Line used in LinkedIn msg], which is why I thought it could make sense to connect.

If it makes sense, I'm happy to share more information about our current projects.

Best regards,
Roelof van Heeren
Fifth Avenue Properties"

OUTPUT JSON:
{ "leads": [{ "email": "...", "connection_request": "...", "email_subject": "...", "email_message": "..." }] }
If no specific fact is found, craft a polite, relevant generic message about their residential investment focus. NEVER return null.`
                },
                research_framework: {
                    facts_to_mention: "Recent acquisitions, fund closing announcements, new hires in acquisitions team.",
                    search_keywords: "Real Estate Private Equity Canada, Institutional Investor Multifamily",
                    manual_workflow: "Google 'Real Estate PE Firm [City]', LinkedIn search for 'Director of Acquisitions' at target firms."
                }
            },
            icp_description: "We target Canadian and US real estate investment firms...",
            exclude_keywords: ["residential brokerage", "property management", "lender"],
            target_locations: ["Canada", "United States"]
        };

        // Update DB
        await upsertIcp(userId, "Family Office", FAMILY_OFFICE_CONFIG, foTermsUnique);
        await upsertIcp(userId, "Investment Firm", INVESTMENT_FIRM_CONFIG, ifTermsUnique);

        console.log('✅ ICPs Optimized with PERFECT configuration.');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

async function upsertIcp(userId, name, config, terms) {
    const searchTermsFormatted = terms.map(t => ({ term: t, last_used_at: null, uses: 0 }));

    // Check exist
    const res = await query('SELECT id FROM icps WHERE user_id = $1 AND name = $2', [userId, name]);

    if (res.rows.length > 0) {
        await query(
            'UPDATE icps SET config = $1, search_terms = $2, updated_at = NOW() WHERE id = $3',
            [JSON.stringify(config), JSON.stringify(searchTermsFormatted), res.rows[0].id]
        );
        console.log(`   Updated: ${name}`);
    } else {
        await query(
            'INSERT INTO icps (user_id, name, config, search_terms, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())',
            [userId, name, JSON.stringify(config), JSON.stringify(searchTermsFormatted)]
        );
        console.log(`   Created: ${name}`);
    }
}

optimizeIcps();
