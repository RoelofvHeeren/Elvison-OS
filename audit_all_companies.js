
import dotenv from 'dotenv';
import { query, pool } from './db/index.js';
import { CompanyScorer } from './src/backend/services/company-scorer.js';

dotenv.config();

async function auditCompanies() {
    try {
        console.log('🔍 Starting Full Company Audit...');

        // 1. Get User ID
        const userRes = await query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        if (userRes.rows.length === 0) {
            console.error('❌ User roelof@elvison.com not found');
            process.exit(1);
        }
        const userId = userRes.rows[0].id;
        console.log(`👤 Audit for User ID: ${userId}`);

        // 2. Fetch all companies
        const companiesRes = await query(`
            SELECT c.*, 
            (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id
                AND link.parent_type = 'user'
            ) as actual_lead_count
            FROM companies c 
            WHERE user_id = $1
        `, [userId]);

        const companies = companiesRes.rows;
        console.log(`📋 Found ${companies.length} companies to audit.`);

        const stats = {
            total: companies.length,
            valid: 0,
            shouldDelete: 0,
            orphans: 0,
            errors: 0
        };

        console.log('\n--- AUDIT DETAILS ---\n');

        // BATCH PROCESSING
        const CONCURRENCY = 5;
        for (let i = 0; i < companies.length; i += CONCURRENCY) {
            const batch = companies.slice(i, i + CONCURRENCY);

            await Promise.all(batch.map(async (company) => {
                try {
                    // Check for orphans
                    if (parseInt(company.actual_lead_count) === 0) {
                        stats.orphans++;
                        // console.log(`⚠️ ORPHAN: ${company.company_name} (0 leads)`);
                    }

                    // Determine ICP Type
                    let type = 'INVESTMENT_FIRM'; // Default
                    if (company.icp_type && company.icp_type.toLowerCase().includes('family')) {
                        type = 'FAMILY_OFFICE';
                    } else if (company.company_name.toLowerCase().includes('family office')) {
                        type = 'FAMILY_OFFICE';
                    }

                    // Check for Canada requirement (mock logic or fetching from ICP config if possible, but for now assuming NO specific geography unless we know)
                    // The user mentioned Family Office and Investment Fund.
                    // We'll trust the scorer's default unless we pass TRUE for Canada. 
                    // Let's assume false for now as per previous context unless specified.

                    // Mock Lead Object for Scorer
                    const mockLead = {
                        company_name: company.company_name,
                        custom_data: {
                            company_profile: company.description || '',
                            company_website: company.website || ''
                        }
                    };

                    const scoreData = await CompanyScorer.rescoreLead(mockLead, type, false);

                    if (scoreData) {
                        if (scoreData.fit_score < 7) {
                            stats.shouldDelete++;
                            console.log(`❌ SHOULD DELETE: ${company.company_name} (Score: ${scoreData.fit_score}) - ${scoreData.fit_reason?.substring(0, 100)}...`);
                        } else {
                            stats.valid++;
                            // console.log(`✅ VALID: ${company.company_name} (Score: ${scoreData.fit_score})`);
                        }
                    } else {
                        stats.errors++;
                        console.log(`❓ ERROR: Could not score ${company.company_name}`);
                    }

                } catch (err) {
                    console.error(`Error auditing ${company.company_name}:`, err.message);
                    stats.errors++;
                }
            }));

            process.stdout.write(`.`);
        }

        console.log('\n\n--- AUDIT SUMMARY ---');
        console.log(`Total Companies: ${stats.total}`);
        console.log(`✅ Valid (Score 7+): ${stats.valid}`);
        console.log(`❌ Should Delete (< 7): ${stats.shouldDelete}`);
        console.log(`⚠️ Orphans (No Leads): ${stats.orphans}`);
        console.log(`❓ Scoring Errors: ${stats.errors}`);

        process.exit(0);
    } catch (e) {
        console.error('Audit failed:', e);
        process.exit(1);
    }
}

auditCompanies();
