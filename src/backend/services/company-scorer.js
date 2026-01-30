
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
        let requiresNorthAmerica = false;
        try {
            const icpRes = await query(`SELECT config FROM icps WHERE id = $1`, [icpId]);
            if (icpRes.rows.length > 0 && icpRes.rows[0].config) {
                const cfg = icpRes.rows[0].config;
                const icpDescription = cfg.surveys?.company_finder?.icp_description || cfg.icp_description || '';
                const lowerDesc = icpDescription.toLowerCase();
                requiresNorthAmerica = lowerDesc.includes('canada') ||
                    lowerDesc.includes('canadian') ||
                    lowerDesc.includes('united states') ||
                    lowerDesc.includes('north america');

                if (requiresNorthAmerica) {
                    console.log(`🌎 North America geography requirement detected for ICP cleanup`);
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
                const scoreData = await this.rescoreLead(company, typeStr, requiresNorthAmerica);

                if (scoreData) {
                    if (scoreData.fit_score < SCORE_THRESHOLD) {
                        // 1. CROSS-CHECK: Is it valid for the OTHER category?
                        // If we are checking FAMILY_OFFICE, check INVESTMENT_FIRM, and vice-versa.
                        const otherTypeStr = isFamilyOffice ? 'INVESTMENT_FIRM' : 'FAMILY_OFFICE';
                        const otherScoreData = await this.rescoreLead(company, otherTypeStr, requiresNorthAmerica);

                        if (otherScoreData && otherScoreData.fit_score >= SCORE_THRESHOLD) {
                            // SUCCESS: It's a miscategorized company! RESCUE IT.
                            console.log(`⚠️  Company ${company.company_name} failed ${typeStr} check but passed ${otherTypeStr}. RESCUING...`);

                            // 2. Find the ID of the 'Other' ICP
                            // Use icp_category instead of name matching for reliability
                            const targetCategory = isFamilyOffice ? 'INVESTMENT_FUND' : 'FAMILY_OFFICE';
                            const { rows: targetIcps } = await query(`
                                SELECT id FROM icps 
                                WHERE user_id = $1 
                                AND (icp_category = $2 OR name ILIKE $3)
                                LIMIT 1
                             `, [company.user_id, targetCategory, `%${targetCategory.replace('_', '%')}%`]);

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

                                // 4. Update Company Type - PRESERVE FO classification, don't downgrade to ASSET_MANAGER
                                let newIcpType = isFamilyOffice ? 'REAL_ESTATE_PRIVATE_EQUITY' : 'FAMILY_OFFICE_SINGLE';
                                // If it's currently a FO, preserve that and just mark as REVIEW
                                if (isFamilyOffice && (company.icp_type === 'FAMILY_OFFICE_SINGLE' || company.icp_type === 'FAMILY_OFFICE_MULTI')) {
                                    // Keep the FO type, don't downgrade
                                    newIcpType = company.icp_type;
                                }

                                await query(`
                                    UPDATE companies 
                                    SET icp_type = $1, 
                                        fit_score = $2, 
                                        fo_status = $3,
                                        last_updated = NOW() 
                                    WHERE company_name = $4 AND user_id = $5
                                 `, [newIcpType, otherScoreData.fit_score, 'REVIEW', company.company_name, company.user_id]);

                                results.kept++;
                                console.log(`✅ Rescued and moved to ICP ID: ${newIcpId} (Type preserved: ${newIcpType})`);
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

    static async rescoreLead(lead, type, requiresNorthAmerica = false) {
        const companyName = lead.company_name;
        const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';
        const website = lead.custom_data?.company_website || lead.custom_data?.website || '';

        // Geography instruction to inject if North America is required
        const geographyInstruction = requiresNorthAmerica ? `
    ** CRITICAL GEOGRAPHY CHECK (NORTH AMERICA):**
        - The user requires companies with a MAJOR NORTH AMERICAN PRESENCE (Canada or USA).
        - IF the company is clearly based in Europe, Asia, Middle East, etc. WITHOUT a North American office or explicit mention of North American investments -> DISQUALIFY IMMEDIATELY (Score 1-3).
        - IF the company is Global, they are ONLY permitted if they mention significant North American operations or active investing in the US/Canada. Otherwise -> DISQUALIFY.
` : '';

        let prompt = '';
        if (type === 'FAMILY_OFFICE') {
            prompt = `You are an expert investment analyst with STRICT evaluation criteria for Single / Multi-Family Offices.

    COMPANY: ${companyName}
    WEBSITE: ${website}
    PROFILE: ${profile.substring(0, 1500)}

    ${geographyInstruction}

    **STRICT REQUIREMENTS - MUST MEET ALL:**
    1. Must be an EXPLICIT Single Family Office (SFO) or Multi-Family Office (MFO) - NOT a wealth manager, advisor, or broker
    2. Must have a DIRECT Real Estate or Private Equity investment arm (not just "alternative investments")
    3. Must have a North American presence (Canada or US) or explicit North American investment mandate

    **AUTOMATIC DISQUALIFICATION (Score 1-4):**
    - Wealth managers, financial advisors, insurance companies
    - Brokers or sales-only firms
    - Consulting firms or service providers
    - Firms that only MANAGE money but don't INVEST directly
    - Unclear or vague investment mandates

    **SCORING (BE STRICT):**
    - **9-10**: Explicitly states SFO/MFO + names specific RE/PE deals or portfolios + North American
    - **8**: Clearly SFO/MFO with direct investment mandate + North American presence
    - **5-7**: Might be an investor but not explicitly SFO/MFO or unclear if direct investing
    - **1-4**: Does not meet strict criteria above

    **WHEN IN DOUBT, SCORE LOW.** Only 8+ scores will be kept.

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
    PROFILE: ${profile.substring(0, 1500)}

    EVALUATION RULES:
    1. **Target**: Private Equity Firms, REITs, Pension Funds, Asset Managers, **Private Investment Firms**, **Holdings Companies**.
    2. **Key Signals**: "Acquisitions", "Development", "Capital Deployment", "Equity Partner", "Joint Venture", "Co-Invest".
    3. **Secondary/Optional**: "Assets Under Management (AUM)" (Valid only if tied to Real Estate).
    4. **Multi-Strategy**: If a firm invests in Tech/Healthcare BUT also Real Estate/Infrastructure, **KEEP THEM** (Score 7-8).
    5. **Holdings**: "Group" or "Holdings" companies that invest are VALID.

    ${geographyInstruction}

    SCORING GUIDELINES:
    - **8-10 (Perfect Fit)**: Dedicated REPE, REIT, or large institutional investor${requiresNorthAmerica ? ' + North American presence' : ''}.
    - **6-7 (Likely Fit/Keep)**: Generalist PE firm, Holdings company with RE assets. **WHEN IN DOUBT, SCORE 6 TO KEEP.**
    - **1-5 (Disqualify)**: Pure Service Providers (Law/Tax), Pure Brokers (Sales only), Lenders (Debt only), Tenants${requiresNorthAmerica ? ', Outside North America without North American strategy' : ''}.

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
