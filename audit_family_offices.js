/**
 * Family Office Audit & Reclassification Script (Non-Destructive)
 * 
 * Usage: 
 *   node audit_family_offices.js --dry-run  (View what would be reclassified)
 *   node audit_family_offices.js --execute  (Actually update classifications and moves)
 *   node audit_family_offices.js --report   (Generate audit report)
 * 
 * NEW BEHAVIOR: Reclassifies misclassified companies instead of deleting them
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

// SMART Family Office Validator (reclassifies instead of rejecting)
const FO_VALIDATOR_PROMPT = `
You are a data quality specialist for a real estate investment database.
Your task: Classify what type of company this actually is.

Company: {company_name}
Domain: {domain}
Profile: {description}

Output ONLY valid JSON:
{
    "entity_type": "FAMILY_OFFICE" | "WEALTH_MANAGER" | "INVESTMENT_FUND" | "OPERATOR" | "UNKNOWN",
    "entity_subtype": "SFO" | "MFO" | "RIA" | "PRIVATE_EQUITY" | "PENSION" | "UNKNOWN",
    "confidence": 0-10,
    "reasoning": "Why this classification",
    "action": "KEEP" | "REVIEW" | "REJECT",
    "suggested_icp": "FAMILY_OFFICE" | "INVESTMENT_FUND" | "OPERATOR" | "OTHER"
}

RULES:
- FAMILY_OFFICE: Proprietary family capital, direct investment
- WEALTH_MANAGER: Advisory, manages client assets
- INVESTMENT_FUND: Third-party capital deployment
- OPERATOR: Real estate developer/operator
- UNKNOWN: Insufficient info

ACTION:
- KEEP: High confidence FO, no issues
- REVIEW: Ambiguous but potentially valuable
- REJECT: Clearly wrong entity type
`;

async function audit() {
    const args = process.argv.slice(2);
    const executeMode = args.includes('--execute');
    const reportMode = args.includes('--report');

    if (!args.includes('--dry-run') && !executeMode && !reportMode) {
        console.log("⚠️  Please specify mode: --dry-run, --execute, or --report");
        process.exit(1);
    }

    try {
        console.log("🔍 Finding 'Family Office' ICPs...");
        const icpRes = await pool.query(`SELECT id, name, icp_category FROM icps WHERE icp_category = 'FAMILY_OFFICE' OR name ILIKE '%Family Office%'`);

        if (icpRes.rows.length === 0) {
            console.log("❌ No Family Office ICPs found.");
            process.exit(0);
        }

        const icpIds = icpRes.rows.map(r => r.id);
        console.log(`Found ICPs: ${icpRes.rows.map(r => r.name).join(', ')}`);

        // Fetch leads/companies associated with these ICPs
        const leadsRes = await pool.query(`
            SELECT DISTINCT l.id, l.company_name, l.custom_data, c.entity_type, c.fo_status
            FROM leads l
            LEFT JOIN companies c ON l.company_name = c.company_name
            WHERE l.icp_id = ANY($1) 
            AND l.status != 'DISQUALIFIED'
            ORDER BY l.created_at DESC
        `, [icpIds]);

        console.log(`\n📋 Reviewing ${leadsRes.rows.length} active leads...`);

        let stats = { 
            kept: 0, 
            reviewed: 0, 
            reclassified_wm: 0,
            reclassified_fund: 0,
            reclassified_op: 0,
            rejected: 0, 
            errors: 0 
        };

        for (const lead of leadsRes.rows) {
            const companyName = lead.company_name;
            let details = {};
            if (typeof lead.custom_data === 'string') {
                try { details = JSON.parse(lead.custom_data); } catch (e) { }
            } else {
                details = lead.custom_data || {};
            }

            const domain = details.company_domain || 'N/A';
            const profile = details.company_profile || details.description || '';

            // Run Classification
            const prompt = FO_VALIDATOR_PROMPT
                .replace('{company_name}', companyName)
                .replace('{domain}', domain)
                .replace('{description}', profile.substring(0, 1000));

            try {
                const result = await model.generateContent(prompt);
                const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
                const analysis = JSON.parse(text);

                // Determine action
                const icon = analysis.action === 'KEEP' ? '✅' : analysis.action === 'REVIEW' ? '⚠️ ' : '❌';
                console.log(`${icon} ${companyName.padEnd(30)} [${analysis.entity_type}] -> ${analysis.action}`);
                
                if (analysis.action !== 'KEEP') {
                    console.log(`    Reason: ${analysis.reasoning}`);
                }

                // Execute actions
                if (executeMode) {
                    if (analysis.action === 'KEEP') {
                        // Mark as approved
                        await pool.query(`
                            UPDATE companies 
                            SET entity_type = $1, 
                                entity_subtype = $2, 
                                entity_confidence = $3,
                                entity_reason = $4,
                                fo_status = 'APPROVED',
                                last_updated = NOW()
                            WHERE company_name = $5
                        `, [analysis.entity_type, analysis.entity_subtype, analysis.confidence / 10, analysis.reasoning, companyName]);
                        stats.kept++;
                    } 
                    else if (analysis.action === 'REVIEW') {
                        // Mark for review
                        await pool.query(`
                            UPDATE companies 
                            SET entity_type = $1, 
                                entity_subtype = $2, 
                                entity_confidence = $3,
                                entity_reason = $4,
                                fo_status = 'REVIEW',
                                last_updated = NOW()
                            WHERE company_name = $5
                        `, [analysis.entity_type, analysis.entity_subtype, analysis.confidence / 10, analysis.reasoning, companyName]);
                        stats.reviewed++;
                    }
                    else if (analysis.action === 'REJECT') {
                        // Move to correct ICP based on entity type
                        if (analysis.entity_type === 'WEALTH_MANAGER') {
                            // Find or create wealth manager ICP
                            const wmIcpRes = await pool.query(
                                `SELECT id FROM icps WHERE icp_category = 'OTHER' AND name ILIKE '%wealth%' LIMIT 1`
                            );
                            if (wmIcpRes.rows.length > 0) {
                                await pool.query(
                                    `UPDATE leads SET icp_id = $1 WHERE company_name = $2 AND icp_id = ANY($3)`,
                                    [wmIcpRes.rows[0].id, companyName, icpIds]
                                );
                                stats.reclassified_wm++;
                            } else {
                                stats.rejected++;
                            }
                        } 
                        else if (analysis.entity_type === 'INVESTMENT_FUND') {
                            const fundIcpRes = await pool.query(
                                `SELECT id FROM icps WHERE icp_category = 'INVESTMENT_FUND' LIMIT 1`
                            );
                            if (fundIcpRes.rows.length > 0) {
                                await pool.query(
                                    `UPDATE leads SET icp_id = $1 WHERE company_name = $2 AND icp_id = ANY($3)`,
                                    [fundIcpRes.rows[0].id, companyName, icpIds]
                                );
                                stats.reclassified_fund++;
                            } else {
                                stats.rejected++;
                            }
                        }
                        else if (analysis.entity_type === 'OPERATOR') {
                            const opIcpRes = await pool.query(
                                `SELECT id FROM icps WHERE icp_category = 'OPERATOR' LIMIT 1`
                            );
                            if (opIcpRes.rows.length > 0) {
                                await pool.query(
                                    `UPDATE leads SET icp_id = $1 WHERE company_name = $2 AND icp_id = ANY($3)`,
                                    [opIcpRes.rows[0].id, companyName, icpIds]
                                );
                                stats.reclassified_op++;
                            } else {
                                stats.rejected++;
                            }
                        } else {
                            stats.rejected++;
                        }
                    }
                }

            } catch (err) {
                console.log(`⚠️  Error analyzing ${companyName}:`, err.message);
                stats.errors++;
            }

            // Rate limit
            await new Promise(r => setTimeout(r, 500));
        }

        console.log("\n--- AUDIT COMPLETE ---");
        console.log(`Kept (FO Approved): ${stats.kept}`);
        console.log(`Under Review: ${stats.reviewed}`);
        console.log(`Reclassified as Wealth Manager: ${stats.reclassified_wm}`);
        console.log(`Reclassified as Investment Fund: ${stats.reclassified_fund}`);
        console.log(`Reclassified as Operator: ${stats.reclassified_op}`);
        console.log(`Rejected: ${stats.rejected}`);
        console.log(`Errors: ${stats.errors}`);

        if (!executeMode) {
            console.log("\nℹ️  Run with --execute to apply changes.");
        } else {
            console.log("\n✅ Audit complete. Classifications updated.");
        }

    } catch (err) {
        console.error("Fatal Error:", err);
    } finally {
        await pool.end();
    }
}

audit();
