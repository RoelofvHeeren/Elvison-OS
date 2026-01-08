
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from '../../../db/index.js';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export class CompanyScorer {

    static async cleanupICP(icpId, icpName) {
        console.log(`🧹 Starting cleanup for ICP: ${icpName} (ID: ${icpId})`);

        // Determine type based on name
        const isFamilyOffice = icpName.toLowerCase().includes('family office');
        const isInvestmentFirm = icpName.toLowerCase().includes('investment firm');

        if (!isFamilyOffice && !isInvestmentFirm) {
            throw new Error(`Unsupported ICP type: ${icpName}. Only 'Family Offices' and 'Investment Firms' are supported.`);
        }

        // Fetch leads for this ICP
        const { rows: leads } = await query(`
            SELECT id, company_name, custom_data 
            FROM leads 
            WHERE icp_id = $1 
            AND status != 'DISQUALIFIED'
        `, [icpId]);

        console.log(`Found ${leads.length} companies to audit.`);

        const results = {
            processed: 0,
            disqualified: 0,
            kept: 0,
            errors: 0
        };

        for (const lead of leads) {
            try {
                const scoreData = await this.rescoreLead(lead, isFamilyOffice ? 'FAMILY_OFFICE' : 'INVESTMENT_FIRM');

                if (scoreData) {
                    // Update DB with new score
                    const updatedCustomData = {
                        ...(lead.custom_data || {}),
                        fit_score: scoreData.fit_score,
                        fit_reason: scoreData.fit_reason,
                        is_investor: scoreData.is_investor,
                        investor_type: scoreData.investor_type,
                        rescored_at: new Date().toISOString()
                    };

                    // STRICT RULE: < 6 => DISQUALIFY
                    if (scoreData.fit_score < 6) {
                        await query(`
                            UPDATE leads 
                            SET status = 'DISQUALIFIED', custom_data = $1 
                            WHERE id = $2
                        `, [updatedCustomData, lead.id]);
                        results.disqualified++;
                    } else {
                        await query(`
                            UPDATE leads 
                            SET custom_data = $1 
                            WHERE id = $2
                        `, [updatedCustomData, lead.id]);
                        results.kept++;
                    }
                } else {
                    results.errors++;
                }
                results.processed++;

                // Rate limit slightly
                await new Promise(r => setTimeout(r, 200));

            } catch (e) {
                console.error(`Error processing lead ${lead.id}:`, e);
                results.errors++;
            }
        }

        return results;
    }

    static async rescoreLead(lead, type) {
        const companyName = lead.company_name;
        const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';
        const website = lead.custom_data?.company_website || lead.custom_data?.website || '';

        let prompt = '';
        if (type === 'FAMILY_OFFICE') {
            prompt = `You are a strict data auditor evaluating if a company is a **Single or Multi-Family Office** that INVESTS in real estate.
            
COMPANY: ${companyName}
WEBSITE: ${website}
PROFILE: ${profile.substring(0, 1500)}

STRICT Criteria (Score 6-10):
- Must be a dedicated Family Office (SFO or MFO) managing private wealth.
- Must actively INVEST capital (Direct RE, PE, Venture).
- "Wealth Management" firms are OKAY ONLY IF they are clearly MFOs with direct investment mandates.

AUTOMATIC FAIL (Score 1-4):
- Mass-market Wealth Advisors / Financial Planners.
- Real Estate Brokers / Agents.
- Tech companies (e.g. Salesforce, Google).
- Service providers (Law, Tax, Consulting).
- Tenants / Retailers.

OUTPUT JSON:
{
    "fit_score": number (1-10),
    "fit_reason": "string (concise reason)",
    "is_investor": boolean,
    "investor_type": "string (SFO/MFO/Wealth Manager/Broker/Tech/Other)"
}`;
        } else {
            // Investment Firm Prompt
            prompt = `You are a strict data auditor evaluating if a company is a **Real Estate Investment Firm**.

COMPANY: ${companyName}
WEBSITE: ${website}
PROFILE: ${profile.substring(0, 1500)}

STRICT Criteria (Score 6-10):
- Private Equity Real Estate firms.
- REITs (Real Estate Investment Trusts).
- Pension Funds with RE allocations.
- Asset Managers with DIRECT Real Estate investment vehicles.
- Must be on the "Buy Side" (Allocators/Investors).

AUTOMATIC FAIL (Score 1-4):
- **Family Offices** (Score LOW here, they belong in a separate list).
- Real Estate **Brokers** / Agencies (They sell, don't invest).
- Property Managers (Operations only).
- Lenders / Banks (unless specifically an equity investment arm).
- Service Providers.
- Tech Companies (e.g. Salesforce).

OUTPUT JSON:
{
    "fit_score": number (1-10),
    "fit_reason": "string (concise reason)",
    "is_investor": boolean,
    "investor_type": "string (PE/REIT/Pension/Broker/Family Office/Other)"
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
