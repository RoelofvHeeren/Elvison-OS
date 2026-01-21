
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from '../../../db/index.js';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export class CompanyScorer {

    static async cleanupICP(icpId, icpName, onProgress) {
        console.log(`🧹 Starting cleanup for ICP: ${icpName} (ID: ${icpId})`);

        // Determine type based on name
        const isFamilyOffice = icpName.toLowerCase().includes('family office');
        const isInvestmentFirm = icpName.toLowerCase().includes('investment firm') || icpName.toLowerCase().includes('investment fund');

        if (!isFamilyOffice && !isInvestmentFirm) {
            throw new Error(`Unsupported ICP type: ${icpName}. Only 'Family Offices' and 'Investment Firms/Funds' are supported.`);
        }

        // Fetch ICP config to check for geography requirements
        let requiresCanada = false;
        try {
            const icpRes = await query(`SELECT config FROM icps WHERE id = $1`, [icpId]);
            if (icpRes.rows.length > 0 && icpRes.rows[0].config) {
                const cfg = icpRes.rows[0].config;
                const icpDescription = cfg.surveys?.company_finder?.icp_description || cfg.icp_description || '';
                requiresCanada = icpDescription.toLowerCase().includes('canada') || icpDescription.toLowerCase().includes('canadian');
                if (requiresCanada) {
                    console.log(`🇨🇦 Canada geography requirement detected for ICP cleanup`);
                }
            }
        } catch (e) {
            console.warn('Failed to fetch ICP config for geography check:', e.message);
        }

        // Get unique companies from leads for this ICP (with their profile data)
        const { rows: companies } = await query(`
            SELECT DISTINCT ON (l.company_name) 
                l.company_name,
                l.user_id,
                l.custom_data
            FROM leads l
            WHERE l.icp_id = $1 
            AND l.status != 'DISQUALIFIED'
        `, [icpId]);

        console.log(`Found ${companies.length} unique companies to audit.`);

        const results = {
            processed: 0,
            disqualified: 0,
            kept: 0,
            errors: 0,
            total: companies.length,
            leadsDeleted: 0
        };

        // BATCH PROCESSING
        const CONCURRENCY_LIMIT = 8;
        const typeStr = isFamilyOffice ? 'FAMILY_OFFICE' : 'INVESTMENT_FIRM';

        // Unified threshold of 7 for all ICP types
        const SCORE_THRESHOLD = 7;

        // Helper to process a single company
        const processCompany = async (company) => {
            try {
                const scoreData = await this.rescoreLead(company, typeStr, requiresCanada);

                if (scoreData) {
                    if (scoreData.fit_score < SCORE_THRESHOLD) {
                        // 1. CROSS-CHECK: Is it valid for the OTHER category?
                        // If we are checking FAMILY_OFFICE, check INVESTMENT_FIRM, and vice-versa.
                        const otherTypeStr = isFamilyOffice ? 'INVESTMENT_FIRM' : 'FAMILY_OFFICE';
                        const otherScoreData = await this.rescoreLead(company, otherTypeStr, requiresCanada);

                        if (otherScoreData && otherScoreData.fit_score >= SCORE_THRESHOLD) {
                            // SUCCESS: It's a miscategorized company! RESCUE IT.
                            console.log(`⚠️  Company ${company.company_name} failed ${typeStr} check but passed ${otherTypeStr}. RESCUING...`);

                            // 2. Find the ID of the 'Other' ICP
                            // We assume standard names based on the user's setup. 
                            // Ideally we query this dynamically or pass map, but for now we look up by name pattern.
                            const targetIcpName = isFamilyOffice ? 'fund' : 'family office';
                            const { rows: targetIcps } = await query(`
                                SELECT id FROM icps 
                                WHERE user_id = $1 
                                AND (name ILIKE $2 OR name ILIKE $3)
                                LIMIT 1
                             `, [company.user_id, `%${targetIcpName}%`, `%${targetIcpName.replace(' ', '%')}%`]);

                            if (targetIcps.length > 0) {
                                const newIcpId = targetIcps[0].id;

                                // 3. Move leads to the new ICP
                                await query(`
                                    UPDATE leads 
                                    SET icp_id = $1, 
                                        custom_data = custom_data || $3::jsonb
                                    WHERE company_name = $2 
                                    AND user_id = $4
                                 `, [newIcpId, company.company_name, JSON.stringify({
                                    fit_score: otherScoreData.fit_score,
                                    rescued_from_cleanup: true,
                                    original_icp_id: icpId,
                                    rescued_at: new Date().toISOString()
                                }), company.user_id]);

                                // 4. Update Company Type
                                const newIcpType = isFamilyOffice ? 'ASSET_MANAGER_MULTI_STRATEGY' : 'FAMILY_OFFICE_SINGLE'; // Default approximations
                                await query(`
                                    UPDATE companies 
                                    SET icp_type = $1, fit_score = $2, last_updated = NOW() 
                                    WHERE company_name = $3 AND user_id = $4
                                 `, [newIcpType, otherScoreData.fit_score, company.company_name, company.user_id]);

                                results.kept++;
                                console.log(`✅ Rescued and moved to ICP ID: ${newIcpId}`);
                                return; // Skip the deletion block
                            } else {
                                console.log(`could not find fallback ICP for ${otherTypeStr}, proceeding to delete...`);
                            }
                        }

                        // DELETE the company AND all its leads (Only if Cross-Check Failed)
                        console.log(`❌ Deleting company: ${company.company_name} (Score: ${scoreData.fit_score}) - Failed both checks.`);

                        // 1. Get IDs of leads to delete for this company and user
                        const { rows: leadsToDelete } = await query(`
                            SELECT l.id FROM leads l
                            JOIN leads_link link ON l.id = link.lead_id
                            WHERE l.company_name = $1 
                            AND link.parent_id = $2 
                            AND link.parent_type = 'user'
                        `, [company.company_name, company.user_id]);

                        const leadIds = leadsToDelete.map(l => l.id);

                        if (leadIds.length > 0) {
                            // 2. Delete from leads_link
                            await query(`
                                DELETE FROM leads_link 
                                WHERE lead_id = ANY($1)
                            `, [leadIds]);

                            // 3. Delete from leads
                            const leadDeleteResult = await query(`
                                DELETE FROM leads 
                                WHERE id = ANY($1)
                            `, [leadIds]);

                            results.leadsDeleted += leadDeleteResult.rowCount;
                        }

                        // 4. Delete company from companies table (this works because companies has valid user_id)
                        await query(`
                            DELETE FROM companies 
                            WHERE company_name = $1 AND user_id = $2
                        `, [company.company_name, company.user_id]);

                        // Also remove from researched_companies if exists
                        await query(`
                            DELETE FROM researched_companies 
                            WHERE company_name = $1 AND user_id = $2
                        `, [company.company_name, company.user_id]);

                        results.disqualified++;
                    } else {
                        // Must find leads via link table again
                        const { rows: leadsToUpdate } = await query(`
                            SELECT l.id FROM leads l
                            JOIN leads_link link ON l.id = link.lead_id
                            WHERE l.company_name = $1 
                            AND link.parent_id = $2 
                            AND link.parent_type = 'user'
                        `, [company.company_name, company.user_id]);

                        const leadIdsToUpdate = leadsToUpdate.map(l => l.id);

                        if (leadIdsToUpdate.length > 0) {
                            await query(`
                                UPDATE leads 
                                SET custom_data = custom_data || $1::jsonb
                                WHERE id = ANY($2)
                            `, [JSON.stringify({
                                fit_score: scoreData.fit_score,
                                fit_reason: scoreData.fit_reason,
                                rescored_at: new Date().toISOString()
                            }), leadIdsToUpdate]);
                        }

                        results.kept++;
                    }
                } else {
                    results.errors++;
                }
                results.processed++;
            } catch (e) {
                console.error(`Error processing company ${company.company_name}:`, e);
                results.errors++;
            }
        };

        // Run with concurrency control
        for (let i = 0; i < companies.length; i += CONCURRENCY_LIMIT) {
            const batch = companies.slice(i, i + CONCURRENCY_LIMIT);
            console.log(`Processing batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1} / ${Math.ceil(companies.length / CONCURRENCY_LIMIT)}`);
            await Promise.all(batch.map(c => processCompany(c)));

            // Report progress
            if (onProgress) {
                onProgress({ ...results });
            }
        }

        console.log(`✅ Cleanup complete: Kept ${results.kept}, Deleted ${results.disqualified} companies(${results.leadsDeleted} leads)`);
        return results;
    }

    static async rescoreLead(lead, type, requiresCanada = false) {
        const companyName = lead.company_name;
        const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';
        const website = lead.custom_data?.company_website || lead.custom_data?.website || '';

        // Geography instruction to inject if Canada is required
        const canadaInstruction = requiresCanada ? `
    ** CRITICAL GEOGRAPHY CHECK(CANADA):**
        - The user STRICTLY requires Canadian companies or firms with explicit Canadian presence.
- Non - Canadian firms without a Canadian office or Canadian investment strategy -> DISQUALIFY(Score 1 - 3).
- Global firms are ONLY permitted if they mention Toronto, Vancouver, Montreal, or "investing in Canada".
` : '';

        let prompt = '';
        if (type === 'FAMILY_OFFICE') {
            prompt = `You are an expert investment analyst with STRICT evaluation criteria for Single / Multi-Family Offices.

    COMPANY: ${companyName}
    WEBSITE: ${website}
    PROFILE: ${profile.substring(0, 2000)}

    ${canadaInstruction}

    CRITICAL FAMILY OFFICE VALIDATION:
    The user is looking for SINGLE FAMILY OFFICES (SFO) or MULTI-FAMILY OFFICES (MFO) that invest DIRECTLY.
    
    YOU MUST DISQUALIFY (Score 1-3) IF THEY ARE:
    - A Wealth Manager / Financial Advisor (unless they explicitly state a DIRECT Real Estate investment arm with PROPRIETARY CAPITAL).
    - A Broker / Intermediary / Capital Advisory / Investment Sales Firm (e.g. Marcus & Millichap, CBRE, JLL, Colliers).
    - A Real Estate Agency (buying/selling individual homes, luxury estates, vineyards, yachts).
    - An Investment Bank.
    - A General Private Equity fund (unless specific to a family or HNWIs).
    - A "Multi-Client Family Office" that just provides services (tax, legal, lifestyle) without a direct investment fund.
    
    ONLY SCORE 8+ IF:
    - They explicitly identify as a Family Office.
    - OR they use language like "proprietary capital", "family capital", "private investment vehicle", "evergreen capital".
    - OR they allow direct deals (not just allocating to funds).

    SCORING GUIDELINES:
    - **9-10**: Explicitly states SFO/MFO + names specific RE/PE deals or portfolios + Canadian
    - **8**: Clearly SFO/MFO with direct investment mandate + Canadian presence
    - **6-7**: Likely SFO/MFO but website is vague (Keep for review)
    - **1-5**: Disqualified based on above criteria

    WHEN IN DOUBT, SCORE LOW. Only 8+ scores will be kept automatically.

    OUTPUT JSON:
    {
        "fit_score": number(1-10),
        "fit_reason": "string (concise reason)",
        "is_investor": boolean,
        "investor_type": "string (SFO/MFO/Wealth Manager/Broker/Other)"
    }`;
        } else {
            // Investment Firm Prompt 
            prompt = `You are an expert investment analyst evaluating if a company is a **Real Estate Investment Firm** or **Institutional Investor**.

    COMPANY: ${companyName}
    WEBSITE: ${website}
    PROFILE: ${profile.substring(0, 2000)}

    ${canadaInstruction}

    CRITICAL INVESTMENT FIRM VALIDATION:
    The user is looking for REAL ESTATE INVESTMENT FIRMS, PRIVATE EQUITY FIRMS, or INSTITUTIONAL INVESTORS that INVEST in Real Estate.
    
    YOU MUST DISQUALIFY (Score 1-3) IF THEY ARE:
    - A Pure Broker / Sales-Only Firm (they don't invest, they just transact/advise).
    - Signals of Brokerage: "Investment Sales", "Capital Markets Advisory", "Debt Placement", "Structuring", "Closing $X in volume", "Representing sellers".
    - A Service Provider (Law, Tax, Consulting, HR, Marketing).
    - A Lender (Debt-only, no equity positions).
    - A Tenant / Occupier (they lease space, don't invest).
    - A Construction / Development Services Company (Builder, Contractor, Architect).
    
    SCORE 6+ IF:
    - They are a Private Equity / Venture firm with Real Estate as a vertical.
    - They are a REIT, Asset Manager, or Pension Fund with RE holdings.
    - They are a "Holdings" or "Group" company with investment mandates.
    - They mention "Acquisitions", "Capital Deployment", "Portfolio Companies", "Equity Partner". 
    - NOTE: Do NOT score high just for "AUM" if they are a pure manager/advisor. They must own/deploy equity.

    SECTOR EXCLUSIONS:
    - IF the company is primarily an "Infrastructure Fund", "Energy Investor", or "Operating Company" (non-real estate) -> DISQUALIFY (Score 2) unless Real Estate is explicitly a major vertical.

    OUTPUT JSON:
    {
        "fit_score": number(1-10),
        "fit_reason": "string (concise reason)",
        "is_investor": boolean,
        "investor_type": "string (PE/REIT/Pension/Holdings/Broker/Other)"
    }`;
        }

        try {
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (e) {
            console.error('Gemini Error:', e.message);
            return null;
        }
    }
}
