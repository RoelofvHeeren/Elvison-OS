
import dotenv from 'dotenv';
import { query } from './db/index.js';
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';
import crypto from 'crypto';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const MAX_LEADS_PER_COMPANY = 10;

async function searchOrphanCompanies() {
    try {
        console.log('🔍 Starting Orphan Company Lead Search...');

        // 1. Get User ID
        const userRes = await query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        if (userRes.rows.length === 0) {
            console.error('❌ User not found');
            process.exit(1);
        }
        const userId = userRes.rows[0].id;
        console.log(`👤 User ID: ${userId}`);

        // 2. Get ICPs
        const icpRes = await query(`SELECT id, name FROM icps WHERE user_id = $1`, [userId]);
        const icps = icpRes.rows;

        // Find relevant ICP (Investment Fund or Family Office)
        const investmentIcp = icps.find(i => i.name.toLowerCase().includes('investment'));
        const familyIcp = icps.find(i => i.name.toLowerCase().includes('family'));
        const defaultIcpId = investmentIcp?.id || familyIcp?.id || icps[0]?.id;

        // 3. Fetch orphan companies
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

        // Filter to only orphans (0 leads) with websites
        const orphans = companiesRes.rows.filter(c =>
            parseInt(c.actual_lead_count) === 0 &&
            c.website &&
            c.website.trim() !== ''
        );

        console.log(`🏢 Found ${orphans.length} orphan companies with websites`);

        if (orphans.length === 0) {
            console.log('✅ No orphans to process!');
            process.exit(0);
        }

        // 4. Extract domains
        const domains = orphans.map(c => {
            let domain = c.website;
            domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
            return domain;
        }).filter(Boolean);

        console.log(`🌐 Domains to search:`, domains.slice(0, 10).join(', '), domains.length > 10 ? `... and ${domains.length - 10} more` : '');

        // 5. Start Apify Search in Batches of 10
        const CHUNK_SIZE = 10;
        const allResults = [];

        for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
            const batchDomains = domains.slice(i, i + CHUNK_SIZE);
            console.log(`\n🚀 Starting Apify search for batch ${Math.floor(i / CHUNK_SIZE) + 1} (${batchDomains.length} domains)...`);

            try {
                const runId = await startApolloDomainScrape(APIFY_TOKEN, batchDomains, {
                    maxLeads: batchDomains.length * MAX_LEADS_PER_COMPANY
                });

                if (!runId) {
                    console.error('❌ Failed to start Apify run for batch');
                    continue;
                }

                console.log(`📊 Apify Run ID: ${runId}`);

                // Poll for completion
                let status = 'RUNNING';
                let datasetId = null;
                let attempts = 0;
                const MAX_ATTEMPTS = 120;

                while (status === 'RUNNING' && attempts < MAX_ATTEMPTS) {
                    await new Promise(r => setTimeout(r, 5000));
                    attempts++;

                    const check = await checkApifyRun(APIFY_TOKEN, runId);
                    status = check.status;
                    datasetId = check.datasetId;

                    process.stdout.write(`\r⏳ Status: ${status} (${attempts * 5}s elapsed)...`);

                    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
                        break;
                    }
                }
                console.log(`\n✅ Batch Status: ${status}`);

                if (status === 'SUCCEEDED' && datasetId) {
                    console.log(`📥 Fetching results from dataset ${datasetId}...`);
                    const batchResults = await getApifyResults(APIFY_TOKEN, datasetId);
                    console.log(`📊 Batch leads returned: ${batchResults.length}`);
                    allResults.push(...batchResults);
                } else {
                    console.error('❌ Batch failed or timed out');
                }
            } catch (err) {
                console.error('Batch error:', err.message);
            }
        }

        const results = allResults;
        console.log(`\n📊 GRAND TOTAL leads returned: ${results.length}`);

        // 8. Group by company and limit to MAX_LEADS_PER_COMPANY
        const leadsByCompany = {};
        for (const lead of results) {
            // ROBUST FIELD MAPPING
            const rawCompany = lead.organizationName || lead.organization?.name || lead.company || 'Unknown';

            if (!leadsByCompany[rawCompany]) {
                leadsByCompany[rawCompany] = [];
            }
            if (leadsByCompany[rawCompany].length < MAX_LEADS_PER_COMPANY) {
                leadsByCompany[rawCompany].push(lead);
            }
        }

        const companiesWithLeads = Object.keys(leadsByCompany).length;
        const totalLeadsToSave = Object.values(leadsByCompany).flat().length;
        console.log(`\n📋 Companies with leads: ${companiesWithLeads}`);
        console.log(`📋 Total leads to save: ${totalLeadsToSave}`);

        // 9. Save to Database
        let savedCount = 0;
        let errorCount = 0;

        for (const [companyName, leads] of Object.entries(leadsByCompany)) {
            for (const lead of leads) {
                try {
                    const leadId = crypto.randomUUID();
                    // Field Mappings
                    const firstName = lead.firstName || lead.first_name || '';
                    const lastName = lead.lastName || lead.last_name || '';
                    const fullName = `${firstName} ${lastName}`.trim() || 'Unknown';
                    const email = lead.email || lead.emails?.[0] || null;
                    const title = lead.title || lead.headline || lead.jobTitle || '';
                    const linkedin = lead.linkedinUrl || lead.linkedInUrl || lead.linkedin_url || lead.linkedin || '';
                    const domain = lead.organizationWebsite || lead.companyWebsite || lead.organization?.websiteUrl || lead.company_domain || '';

                    let icpId = defaultIcpId;
                    if (companyName.toLowerCase().includes('family office')) {
                        icpId = familyIcp?.id || defaultIcpId;
                    }

                    // Insert lead with CORRECT SCHEMA (person_name, job_title)
                    await query(`
                        INSERT INTO leads (id, company_name, person_name, linkedin_url, email, job_title, status, icp_id, custom_data)
                        VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, $8)
                        ON CONFLICT (id) DO NOTHING
                    `, [
                        leadId,
                        companyName,
                        fullName,
                        linkedin,
                        email,
                        title,
                        icpId,
                        JSON.stringify({
                            source: 'apify_orphan_search',
                            company_website: domain,
                            searched_at: new Date().toISOString()
                        })
                    ]);

                    // Link to user
                    await query(`
                        INSERT INTO leads_link (lead_id, parent_id, parent_type)
                        VALUES ($1, $2, 'user')
                        ON CONFLICT DO NOTHING
                    `, [leadId, userId]);

                    savedCount++;
                } catch (e) {
                    console.error(`Error saving lead for ${companyName}:`, e.message);
                    errorCount++;
                }
            }
        }

        console.log(`\n✅ COMPLETE!`);
        console.log(`   Leads Saved: ${savedCount}`);
        console.log(`   Errors: ${errorCount}`);
        console.log(`   Companies Enriched: ${companiesWithLeads}`);

        process.exit(0);
    } catch (e) {
        console.error('Search failed:', e);
        process.exit(1);
    }
}

searchOrphanCompanies();
