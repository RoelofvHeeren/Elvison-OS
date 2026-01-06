/**
 * Company Profile Re-Scorer - INVESTORS ONLY
 * 
 * Re-evaluates all companies with strict ICP:
 * - Family offices that invest in real estate
 * - Real estate investment firms
 * - Pension funds with RE allocation
 * - Private equity firms focused on real estate
 * 
 * NOT: Brokerages, tenants, suppliers, marketing agencies, service providers
 * 
 * Usage: DATABASE_URL="your-url" node rescore_companies.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function rescoreCompany(companyName, currentProfile, domain) {
    const prompt = `You are an ICP fit evaluator for a Canadian real estate developer looking for INVESTMENT PARTNERS.

COMPANY: ${companyName}
DOMAIN: ${domain || 'Unknown'}
CURRENT PROFILE: ${currentProfile || 'No profile available'}

OUR ICP (who we want):
- Family offices that INVEST in real estate
- Real estate investment firms/REITs that INVEST capital
- Private equity firms focused on real estate INVESTMENTS
- Pension funds with real estate INVESTMENT allocations
- Institutional investors in Canadian real estate

NOT OUR ICP (automatic LOW score):
- Real estate BROKERAGES (they sell properties, don't invest) - score 2-3
- TENANTS or potential tenants - score 1-2
- SUPPLIERS (magnets, manufacturing, electronics, etc.) - score 1-2
- MARKETING AGENCIES or service providers - score 1-2
- Healthcare providers, dermatology clinics, etc. - score 1-2
- Any company that doesn't INVEST THEIR OWN CAPITAL in real estate - score 1-4

SCORING CRITERIA:
- 9-10: Perfect - They actively INVEST capital in Canadian residential real estate development
- 7-8: Strong - Family office or PE firm that invests in real estate, may have RE allocation
- 5-6: Potential - Financial institution that MIGHT invest but no clear RE focus
- 3-4: Weak - Related to real estate but NOT an investor (brokerages, property managers)
- 1-2: Not a fit - Completely unrelated (suppliers, agencies, healthcare, retail, etc.)

CRITICAL: A real estate BROKERAGE is NOT an investor. They help people buy/sell, but they don't invest their own capital. Score them 2-3 max.

OUTPUT FORMAT (JSON only):
{
    "fit_score": 8,
    "fit_reason": "Why this score - be specific about whether they INVEST capital or not",
    "is_investor": true,
    "investor_type": "Family Office / REIT / PE Firm / Pension Fund / Brokerage / Service Provider / Not Relevant"
}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return null;
    } catch (e) {
        console.log(`   ⚠️ Error: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('🔄 Company Re-Scorer - INVESTORS ONLY\n');

    if (!pool.options.connectionString) {
        console.error('❌ DATABASE_URL not set');
        process.exit(1);
    }

    try {
        // Get all enriched companies
        const result = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                id, company_name, 
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'company_profile' as profile,
                custom_data->>'fit_score' as current_score,
                custom_data as full_custom_data
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            AND custom_data->>'company_profile' IS NOT NULL
            ORDER BY company_name, created_at DESC
        `);

        console.log(`📊 Found ${result.rows.length} companies to re-score\n`);

        let rescored = 0;
        let lowFit = 0;
        let investors = 0;

        for (let i = 0; i < result.rows.length; i++) {
            const company = result.rows[i];
            console.log(`${i + 1}/${result.rows.length}: ${company.company_name} (was ${company.current_score || '?'}/10)`);

            const scoreData = await rescoreCompany(
                company.company_name,
                company.profile,
                company.website || company.domain
            );

            if (!scoreData) {
                console.log('   ⚠️ Could not rescore');
                continue;
            }

            console.log(`   ⭐ NEW Score: ${scoreData.fit_score}/10 - ${scoreData.investor_type}`);
            console.log(`   📝 ${scoreData.fit_reason.substring(0, 80)}...`);

            if (scoreData.is_investor) {
                console.log('   ✅ IS AN INVESTOR');
                investors++;
            }

            if (scoreData.fit_score < 4) {
                console.log('   🗑️ LOW FIT - Should delete');
                lowFit++;
            }

            // Update the database with new score
            const updatedCustomData = {
                ...company.full_custom_data,
                fit_score: scoreData.fit_score,
                fit_reason: scoreData.fit_reason,
                is_investor: scoreData.is_investor,
                investor_type: scoreData.investor_type,
                rescored_at: new Date().toISOString()
            };

            await pool.query(
                `UPDATE leads SET custom_data = $1 WHERE company_name = $2`,
                [updatedCustomData, company.company_name]
            );

            rescored++;

            // Small delay
            await new Promise(r => setTimeout(r, 300));
        }

        console.log(`\n\n📊 SUMMARY:`);
        console.log(`   ✅ Rescored: ${rescored} companies`);
        console.log(`   💰 Actual investors: ${investors} companies`);
        console.log(`   🗑️ Low fit (should delete): ${lowFit} companies`);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
