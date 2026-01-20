
import dotenv from 'dotenv';
import { query } from './db/index.js';
import { CompanyScorer } from './src/backend/services/company-scorer.js';

dotenv.config();

async function processAuditActions() {
    try {
        console.log('🚀 Starting Audit Action Processing...');

        // 1. Get User ID
        const userRes = await query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        if (userRes.rows.length === 0) {
            console.error('❌ User roelof@elvison.com not found');
            process.exit(1);
        }
        const userId = userRes.rows[0].id;
        console.log(`👤 User ID: ${userId}`);

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
        console.log(`📋 Processing ${companies.length} companies...`);

        const stats = {
            deleted: 0,
            goodOrphans: [],
            errors: 0
        };

        const CONCURRENCY = 5;
        for (let i = 0; i < companies.length; i += CONCURRENCY) {
            const batch = companies.slice(i, i + CONCURRENCY);

            await Promise.all(batch.map(async (company) => {
                try {
                    // Determine ICP Type
                    let type = 'INVESTMENT_FIRM';
                    if (company.icp_type && company.icp_type.toLowerCase().includes('family')) {
                        type = 'FAMILY_OFFICE';
                    } else if (company.company_name.toLowerCase().includes('family office')) {
                        type = 'FAMILY_OFFICE';
                    }

                    // Mock Lead Object for Scorer
                    const mockLead = {
                        company_name: company.company_name,
                        custom_data: {
                            company_profile: company.description || '',
                            company_website: company.website || ''
                        }
                    };

                    // RESCORE
                    const scoreData = await CompanyScorer.rescoreLead(mockLead, type, false);

                    if (scoreData) {
                        const isOrphan = parseInt(company.actual_lead_count) === 0;

                        if (scoreData.fit_score < 7) {
                            // --- DELETE LOGIC ---
                            // console.log(`🗑️ DELETING INVALID: ${company.company_name} (Score: ${scoreData.fit_score})`);

                            // 1. Get IDs of leads to delete for this company and user
                            const { rows: leadsToDelete } = await query(`
                                SELECT l.id FROM leads l
                                JOIN leads_link link ON l.id = link.lead_id
                                WHERE l.company_name = $1 
                                AND link.parent_id = $2 
                                AND link.parent_type = 'user'
                            `, [company.company_name, userId]);

                            const leadIds = leadsToDelete.map(l => l.id);

                            if (leadIds.length > 0) {
                                // 2. Delete from leads_link
                                await query(`DELETE FROM leads_link WHERE lead_id = ANY($1)`, [leadIds]);
                                // 3. Delete from leads
                                await query(`DELETE FROM leads WHERE id = ANY($1)`, [leadIds]);
                            }

                            // 4. Delete company
                            await query(`DELETE FROM companies WHERE company_name = $1 AND user_id = $2`, [company.company_name, userId]);
                            // 5. Delete researched_companies
                            await query(`DELETE FROM researched_companies WHERE company_name = $1 AND user_id = $2`, [company.company_name, userId]);

                            stats.deleted++;
                        } else {
                            // Score >= 7
                            if (isOrphan) {
                                // --- VALID ORPHAN ---
                                stats.goodOrphans.push({
                                    name: company.company_name,
                                    score: scoreData.fit_score,
                                    reason: scoreData.fit_reason,
                                    website: company.website,
                                    icp_id: company.icp_type // Note: companies table might use icp_type loosely, need real ID for apify later
                                });
                            }
                        }
                    } else {
                        stats.errors++;
                        console.log(`❓ ERROR: Could not score ${company.company_name}`);
                    }

                } catch (err) {
                    console.error(`Error processing ${company.company_name}:`, err.message);
                    stats.errors++;
                }
            }));
            process.stdout.write(`.`);
        }

        console.log('\n\n--- ACTION SUMMARY ---');
        console.log(`🗑️ Deleted Invalid Companies: ${stats.deleted}`);
        console.log(`✅ Good Orphans Found: ${stats.goodOrphans.length}`);

        if (stats.goodOrphans.length > 0) {
            console.log('\n--- GOOD FIT ORPHANS (Ready for Search) ---');
            stats.goodOrphans.forEach(o => {
                console.log(`- [${o.score}/10] ${o.name} (${o.website})`);
                console.log(`  Reason: ${o.reason?.substring(0, 100)}...`);
            });
        }

        process.exit(0);
    } catch (e) {
        console.error('Processing failed:', e);
        process.exit(1);
    }
}

processAuditActions();
