
import dotenv from 'dotenv';
import { query } from './db/index.js';
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const MAX_LEADS_PER_COMPANY = 5; // Get a few to choose from

async function getLenientLeadsReport() {
    try {
        console.log('🔍 Starting Lenient Lead Search for Report...');

        const userRes = await query(`SELECT id FROM users WHERE email = 'roelof@elvison.com'`);
        const userId = userRes.rows[0].id;

        // 1. Fetch remaining orphans
        const companiesRes = await query(`
            SELECT c.company_name, c.website,
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

        const orphans = companiesRes.rows.filter(c =>
            parseInt(c.actual_lead_count) === 0 &&
            c.website &&
            c.website.trim() !== ''
        );

        console.log(`🏢 Processing ${orphans.length} orphan companies...`);

        // Deduplicate domains
        const domains = [...new Set(orphans.map(c => {
            let domain = c.website;
            return domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
        }).filter(Boolean))];

        const CHUNK_SIZE = 2; // Small chunks to ensure we get results for each domain
        const allResults = [];

        for (let i = 0; i < domains.length; i += CHUNK_SIZE) {
            const batchDomains = domains.slice(i, i + CHUNK_SIZE);
            console.log(`\n🚀 Searching batch ${Math.floor(i / CHUNK_SIZE) + 1} (${batchDomains.length} domains: ${batchDomains.join(', ')})...`);

            try {
                // RUN WITH LENIENT MODE
                const runId = await startApolloDomainScrape(APIFY_TOKEN, batchDomains, {
                    maxLeads: 100, // Request 100 total for just 2 domains
                    lenientMode: true
                });

                if (!runId) continue;

                // Poll
                let status = 'RUNNING';
                let datasetId = null;
                let attempts = 0;
                while (status === 'RUNNING' && attempts < 60) {
                    await new Promise(r => setTimeout(r, 5000));
                    attempts++;
                    const check = await checkApifyRun(APIFY_TOKEN, runId);
                    status = check.status;
                    datasetId = check.datasetId;
                    process.stdout.write(`\r⏳ ${status}...`);
                }

                if (status === 'SUCCEEDED') {
                    console.log(`\n✅ Batch Succeeded. Dataset: ${datasetId}`);
                    if (datasetId) {
                        const batchResults = await getApifyResults(APIFY_TOKEN, datasetId);
                        console.log(`📊 Batch leads returned: ${batchResults.length}`);
                        allResults.push(...batchResults);
                    } else {
                        console.error('❌ No datasetId found for successful run');
                    }
                } else {
                    console.error(`❌ Batch failed or timed out. Status: ${status}`);
                }
            } catch (err) {
                console.error(err.message);
            }
        }

        // Generate Report
        const filteredResults = allResults.filter(l =>
            l.fullName &&
            !l.fullName.includes('🟢') &&
            !l.fullName.includes('log') &&
            (l.email || l.organizationName || l.organization || l.position)
        );

        console.log(`\n📊 Total Actual Leads: ${filteredResults.length} (Filtered from ${allResults.length})`);

        console.log('\n\n==========================================');
        console.log('🔎 LENIENT LEAD REPORT');
        console.log('==========================================\n');

        const leadsByCompany = {};
        for (const lead of filteredResults) {
            const company = lead.organizationName || lead.organization?.name || lead.company || lead.organization_name || 'Unknown';
            if (!leadsByCompany[company]) leadsByCompany[company] = [];
            leadsByCompany[company].push(lead);
        }

        for (const [company, leads] of Object.entries(leadsByCompany)) {
            console.log(`🏢 ${company}`);
            // Take top 3
            leads.slice(0, 3).forEach(l => {
                const name = `${l.firstName || ''} ${l.lastName || ''}`.trim();
                const title = l.title || l.headline || l.jobTitle || l.position || 'No Title';
                const linkedIn = l.linkedinUrl || l.linkedInUrl || 'No LI';
                console.log(`   - ${name} | ${title}`);
                console.log(`     🔗 ${linkedIn}`);
            });
            console.log('');
        }

        console.log(`\nReport Complete. Found potential leads for ${Object.keys(leadsByCompany).length} companies.`);
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

getLenientLeadsReport();
