
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

        // Stricter threshold for Family Offices (8), standard for Investment Firms (6)
        const SCORE_THRESHOLD = isFamilyOffice ? 8 : 6;

        // Helper to process a single company
        const processCompany = async (company) => {
            try {
                const scoreData = await this.rescoreLead(company, typeStr, requiresCanada);

                if (scoreData) {
                    if (scoreData.fit_score < SCORE_THRESHOLD) {
                        // DELETE the company AND all its leads
                        console.log(`❌ Deleting company: ${company.company_name} (Score: ${scoreData.fit_score})`);

                        // Delete leads first
                        const leadDeleteResult = await query(`
                            DELETE FROM leads 
                            WHERE company_name = $1 AND user_id = $2
                            RETURNING id
                        `, [company.company_name, company.user_id]);

                        results.leadsDeleted += leadDeleteResult.rowCount;

                        // Delete company from companies table
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
                        // Keep - update the score in custom_data for all leads of this company
                        await query(`
                            UPDATE leads 
                            SET custom_data = custom_data || $1::jsonb
                            WHERE company_name = $2 AND user_id = $3
                        `, [JSON.stringify({
                            fit_score: scoreData.fit_score,
                            fit_reason: scoreData.fit_reason,
                            rescored_at: new Date().toISOString()
                        }), company.company_name, company.user_id]);

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

        console.log(`✅ Cleanup complete: Kept ${results.kept}, Deleted ${results.disqualified} companies (${results.leadsDeleted} leads)`);
        return results;
    }

    static async rescoreLead(lead, type, requiresCanada = false) {
        const companyName = lead.company_name;
        const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';
        const website = lead.custom_data?.company_website || lead.custom_data?.website || '';

        // Geography instruction to inject if Canada is required
        const canadaInstruction = requiresCanada ? `
**CRITICAL GEOGRAPHY CHECK (CANADA):**
- The user STRICTLY requires Canadian companies or firms with explicit Canadian presence.
- Non-Canadian firms without a Canadian office or Canadian investment strategy -> DISQUALIFY (Score 1-3).
- Global firms are ONLY permitted if they mention Toronto, Vancouver, Montreal, or "investing in Canada".
` : '';

        let prompt = '';
        if (type === 'FAMILY_OFFICE') {
            prompt = `You are an expert investment analyst with STRICT evaluation criteria for Single/Multi-Family Offices.

COMPANY: ${companyName}
WEBSITE: ${website}
PROFILE: ${profile.substring(0, 1500)}

**STRICT REQUIREMENTS - MUST MEET ALL:**
1. Must be an EXPLICIT Single Family Office (SFO) or Multi-Family Office (MFO) - NOT a wealth manager, advisor, or broker
2. Must have a DIRECT Real Estate or Private Equity investment arm (not just "alternative investments")
3. Must be Canadian-based or have explicit Canadian investment mandate

**AUTOMATIC DISQUALIFICATION (Score 1-4):**
- Wealth managers, financial advisors, insurance companies
- Brokers or sales-only firms
- Consulting firms or service providers
- Non-Canadian firms without explicit Canadian office/strategy
- Firms that only MANAGE money but don't INVEST directly
- Unclear or vague investment mandates

**SCORING (BE STRICT):**
- **9-10**: Explicitly states SFO/MFO + names specific RE/PE deals or portfolios + Canadian
- **8**: Clearly SFO/MFO with direct investment mandate + Canadian presence
- **5-7**: Might be an investor but not explicitly SFO/MFO or unclear if direct investing
- **1-4**: Does not meet strict criteria above

**WHEN IN DOUBT, SCORE LOW.** Only 8+ scores will be kept.

OUTPUT JSON:
{
    "fit_score": number (1-10),
    "fit_reason": "string (concise reason)",
    "is_investor": boolean,
    "investor_type": "string (SFO/MFO/Wealth Manager/Broker/Other)"
}`;
        } else {
            // Investment Firm Prompt - NOW WITH OPTIONAL CANADA CHECK
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

${canadaInstruction}

SCORING GUIDELINES:
- **8-10 (Perfect Fit)**: Dedicated REPE, REIT, or large institutional investor${requiresCanada ? ' + Canadian presence' : ''}.
- **6-7 (Likely Fit / Keep)**: Generalist PE firm, Holdings company with RE assets. **WHEN IN DOUBT, SCORE 6 TO KEEP.**
- **1-5 (Disqualify)**: Pure Service Providers (Law/Tax), Pure Brokers (Sales only), Lenders (Debt only), Tenants${requiresCanada ? ', Non-Canadian without Canadian strategy' : ''}.

OUTPUT JSON:
{
    "fit_score": number (1-10),
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
