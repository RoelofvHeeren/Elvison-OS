
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

        // Helper to process a single company
        const processCompany = async (company) => {
            try {
                const scoreData = await this.rescoreLead(company, typeStr);

                if (scoreData) {
                    if (scoreData.fit_score < 6) {
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

    static async rescoreLead(lead, type) {
        const companyName = lead.company_name;
        const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';
        const website = lead.custom_data?.company_website || lead.custom_data?.website || '';

        let prompt = '';
        if (type === 'FAMILY_OFFICE') {
            prompt = `You are an expert investment analyst evaluating if a company is a **Single or Multi-Family Office** that INVESTS in real estate or private equity.

COMPANY: ${companyName}
WEBSITE: ${website}
PROFILE: ${profile.substring(0, 1500)}

EVALUATION RULES:
1. **Target**: Single Family Offices (SFO), Multi-Family Offices (MFO), Private Wealth Firms with *direct investment* mandates.
2. **Key Signals**: Terms like "Direct Investment", "Private Capital", "Long-term capital", "Proprietary Capital", "Real Estate Portfolio".
3. **Wealth Managers**: Standard wealth managers are usually disqualified, BUT if they mention specific "Alternative Investment" platforms, "Private Strategies", or "Direct Deals", **KEEP THEM** (Score 6-7).

SCORING GUIDELINES:
- **8-10 (Perfect Fit)**: Explicitly identifies as SFO/MFO with direct real estate/PE arm AND confirms Canadian presence/focus.
- **6-7 (Likely Fit / Keep)**: "Private Wealth" or "Investment Management" firm that appears to have discretion or direct deals. **WHEN IN DOUBT, BUT THEY ARE CANADIAN, SCORE 6 TO KEEP.**
- **1-5 (Disqualify)**: Retail financial planners, pure brokers, insurance agents, tenants.
- **1 (Major Disqualification)**: Non-Canadian Firm (e.g. US, UK, Middle East) unless they explicitly mention a "Toronto" or "Vancouver" office or "Canadian Investment Strategy".

CRITICAL GEOGRAPHY RULE:
IF the company is NOT based in Canada AND does not mention a Canadian office/strategy -> SCORE 1.

OUTPUT JSON:
{
    "fit_score": number (1-10),
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
2. **Key Signals**: "Acquisitions", "Development", "Capital Deployment", "Assets Under Management (AUM)", "Equity Partner".
3. **Multi-Strategy**: If a firm invests in Tech/Healthcare BUT also Real Estate/Infrastructure, **KEEP THEM** (Score 7-8).
4. **Holdings**: "Group" or "Holdings" companies that invest are VALID.

SCORING GUIDELINES:
- **8-10 (Perfect Fit)**: Dedicated REPE, REIT, or large institutional investor.
- **6-7 (Likely Fit / Keep)**: Generalist PE firm, Holdings company with RE assets. **WHEN IN DOUBT, SCORE 6 TO KEEP.**
- **1-5 (Disqualify)**: Pure Service Providers (Law/Tax), Pure Brokers (Sales only), Lenders (Debt only), Tenants.

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
