/**
 * Family Office Audit & Cleanup Script
 * 
 * Usage: 
 *   node audit_family_offices.js --dry-run  (View what would be removed)
 *   node audit_family_offices.js --execute  (Actually set status='DISQUALIFIED')
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

// STRICT Family Office Validation Prompt
const STRICT_FO_PROMPT = `
You are a strict data auditor for a Real Estate Private Equity firm.
Your task is to determine if the following company is a **TRUE Single Family Office (SFO)** or **Multi-Family Office (MFO)** that actively invests DIRECTLY in real estate/venture.

We have a problem with "Wealth Managers", "Financial Advisors", "Investment Banks", and "Brokers" slipping through. 
You must DISQUALIFY them.

Company: {company_name}
Domain: {domain}
Description/Profile: {description}

**STRICT CRITERIA for PASS:**
1. Must be a proprietary investment vehicle for a high-net-worth family or families.
2. Must have language indicating "direct investment", "private capital", "proprietary capital", or "family investment vehicle".
3. OR be a strictly defined Multi-Family Office that manages *direct* investments (not just asset allocation/advisory).

**CRITERIA for FAIL (DISQUALIFY):**
- Wealth Management / Wealth Advisory (unless they explicitly state they have a direct RE investment arm)
- Financial Planning / Tax Services
- Investment Banking / Brokerage
- General Private Equity (unless it's a known family vehicle)
- Real Estate Developer (unless they have a distinct family office arm)

**OUTPUT FORMAT (JSON ONLY):**
{
    "is_family_office": boolean,
    "confidence": number (1-10),
    "reason": "Short explanation of why it passed or failed",
    "classification": "SFO" | "MFO" | "Wealth Manager" | "Advisor" | "Other"
}
`;

async function audit() {
    const args = process.argv.slice(2);
    const executeMode = args.includes('--execute');

    if (!args.includes('--dry-run') && !executeMode) {
        console.log("⚠️  Please specify mode: --dry-run or --execute");
        process.exit(1);
    }

    try {
        console.log("🔍 Finding 'Family Office' ICPs...");
        const icpRes = await pool.query(`SELECT id, name FROM icps WHERE name ILIKE '%Family Office%'`);

        if (icpRes.rows.length === 0) {
            console.log("No ICPs found with 'Family Office' in the name.");
            process.exit(0);
        }

        const icpIds = icpRes.rows.map(r => r.id);
        console.log(`Found ICPs: ${icpRes.rows.map(r => r.name).join(', ')}`);

        // Fetch leads/companies associated with these ICPs
        // Using 'leads' table as primary source
        const leadsRes = await pool.query(`
            SELECT id, company_name, custom_data 
            FROM leads 
            WHERE icp_id = ANY($1) 
            AND status != 'DISQUALIFIED'
            ORDER BY created_at DESC
        `, [icpIds]);

        console.log(`\n📋 Reviewing ${leadsRes.rows.length} active leads...`);

        let stats = { kept: 0, disqualified: 0, errors: 0 };

        for (const lead of leadsRes.rows) {
            const companyName = lead.company_name;
            const domain = lead.custom_data?.company_domain || 'N/A';
            const profile = lead.custom_data?.company_profile || lead.custom_data?.description || '';

            // Run Strict Validation
            const prompt = STRICT_FO_PROMPT
                .replace('{company_name}', companyName)
                .replace('{domain}', domain)
                .replace('{description}', profile.substring(0, 1000));

            try {
                const result = await model.generateContent(prompt);
                const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                const analysis = JSON.parse(text);

                const isPass = analysis.is_family_office === true;
                const icon = isPass ? '✅' : '❌';

                console.log(`${icon} ${companyName.padEnd(30)} [${analysis.classification}] ${isPass ? '' : '-> DISQUALIFY'}`);
                if (!isPass) console.log(`    Reason: ${analysis.reason}`);

                if (!isPass) {
                    stats.disqualified++;
                    if (executeMode) {
                        await pool.query(`
                            UPDATE leads 
                            SET status = 'DISQUALIFIED', 
                                custom_data = jsonb_set(custom_data, '{audit_reason}', to_jsonb($1::text))
                            WHERE id = $2
                        `, [analysis.reason, lead.id]);
                    }
                } else {
                    stats.kept++;
                }

            } catch (err) {
                console.log(`⚠️  Error analyzing ${companyName}:`, err.message);
                stats.errors++;
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 500));
        }

        console.log("\n--- AUDIT COMPLETE ---");
        console.log(`Kept: ${stats.kept}`);
        console.log(`Disqualified: ${stats.disqualified}`);
        console.log(`Errors: ${stats.errors}`);

        if (!executeMode) {
            console.log("\nℹ️  Run with --execute to apply changes.");
        }

    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

audit();
