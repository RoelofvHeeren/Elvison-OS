import dotenv from 'dotenv';
import { query } from './db/index.js';
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';
import crypto from 'crypto';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const USER_EMAIL = 'roelof@elvison.com';

async function saveLenientLeads() {
    try {
        console.log('💾 Saving Approved Lenient Leads...');

        // 1. Get User and ICPs
        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;
        const icpsRes = await query(`SELECT id, name FROM icps WHERE user_id = $1`, [userId]);
        const icps = icpsRes.rows;

        // 2. Fetch remaining orphans (already have the domains from previous step, but let's re-fetch to be safe)
        const companiesRes = await query(`
            SELECT c.company_name, c.website
            FROM companies c 
            WHERE user_id = $1
            AND (
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE l.company_name = c.company_name 
                AND link.parent_id = c.user_id
            ) = 0
            AND website IS NOT NULL AND website != ''
        `, [userId]);

        const domains = [...new Set(companiesRes.rows.map(c => {
            let domain = c.website;
            return domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
        }).filter(Boolean))];

        console.log(`🏢 Checking ${domains.length} potential orphans...`);

        // 3. Search (Actually just run the search again but SAVE this time)
        const CHUNK_SIZE = 2;
        let totalSaved = 0;

        for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
            const batchDomains = domains.slice(i, i + CHUNK_SIZE);
            console.log(`\n🚀 Searching & Saving batch ${Math.floor(i / CHUNK_SIZE) + 1}...`);

            const runId = await startApolloDomainScrape(APIFY_TOKEN, batchDomains, {
                maxLeads: 100,
                lenientMode: true
            });

            if (!runId) continue;

            let status = 'RUNNING';
            let datasetId = null;
            while (status === 'RUNNING') {
                await new Promise(r => setTimeout(r, 5000));
                const check = await checkApifyRun(APIFY_TOKEN, runId);
                status = check.status;
                datasetId = check.datasetId;
                process.stdout.write(`\r⏳ ${status}...`);
            }

            if (status === 'SUCCEEDED' && datasetId) {
                const results = await getApifyResults(APIFY_TOKEN, datasetId);
                const filteredLeads = results.filter(l =>
                    l.fullName && !l.fullName.includes('🟢') && (l.email || l.linkedinUrl || l.position)
                );

                // Group by company to limit to 5
                const leadsByCompany = {};
                filteredLeads.forEach(l => {
                    const co = l.organizationName || l.organization?.name || l.company || l.organization_name || 'Unknown';
                    if (!leadsByCompany[co]) leadsByCompany[co] = [];
                    leadsByCompany[co].push(l);
                });

                for (const [coName, leads] of Object.entries(leadsByCompany)) {
                    if (coName === 'Unknown') continue;

                    console.log(`\n📂 Saving leads for: ${coName}`);

                    // Match ICP
                    const icpMatch = icps.find(icp =>
                        coName.toLowerCase().includes('asset management') ||
                        coName.toLowerCase().includes('capital') ||
                        coName.toLowerCase().includes('reit') ||
                        coName.toLowerCase().includes('fund')
                    ) || icps[0];

                    for (const lead of leads.slice(0, 5)) {
                        const leadId = crypto.randomUUID();
                        const personName = lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
                        const jobTitle = lead.title || lead.headline || lead.jobTitle || lead.position || 'Unknown Title';
                        const linkedIn = lead.linkedinUrl || lead.linkedInUrl || '';

                        try {
                            let existingLeadId = null;

                            // 1. Check if lead exists
                            if (linkedIn) {
                                const result = await query(`SELECT id FROM leads WHERE linkedin_url = $1`, [linkedIn]);
                                if (result.rows.length > 0) {
                                    existingLeadId = result.rows[0].id;
                                    console.log(`⚠️ Lead exists, ensuring link: ${personName}`);
                                }
                            }

                            // 2. Insert Lead if not exists
                            if (!existingLeadId) {
                                await query(`
                                    INSERT INTO leads (
                                        id, company_name, person_name, email, job_title, linkedin_url, 
                                        status, source, user_id, icp_id
                                    )
                                    VALUES ($1, $2, $3, $4, $5, $6, 'NEW', 'Apollo', $7, $8)
                                `, [
                                    leadId, coName, personName, lead.email || null, jobTitle, linkedIn,
                                    userId, icpMatch?.id || null
                                ]);
                                existingLeadId = leadId;
                                totalSaved++;
                            }

                            // 3. Ensure Link exists (User)
                            if (existingLeadId) {
                                await query(`
                                    INSERT INTO leads_link (lead_id, parent_id, parent_type)
                                    VALUES ($1, $2, 'user')
                                    ON CONFLICT (lead_id, parent_id, parent_type) DO NOTHING
                                `, [existingLeadId, userId]);
                            }
                        } catch (err) {
                            console.error(`❌ Error saving ${personName}:`, err.message);
                        }
                    }
                }
            }
        }

        console.log(`\n✅ Finished! Saved ${totalSaved} leads.`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

saveLenientLeads();
