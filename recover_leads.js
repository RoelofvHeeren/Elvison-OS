
import pg from 'pg';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ACTOR_ID = 'GlxYrQp6f3YAzH2W2'; // Leads Scraper (Rental)

// Helper to delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    console.log('🚑 STARTING LEAD RECOVERY...');

    // 1. Fetch Valid Companies
    const res = await pool.query(`
        SELECT id, company_name, custom_data, icp_id 
        FROM leads 
        WHERE status != 'DISQUALIFIED'
    `);

    const companies = res.rows;
    console.log(`🔍 Found ${companies.length} companies to recover leads for.`);

    // 2. Extract Domains
    const validCompanies = [];
    const domains = [];

    for (const c of companies) {
        let domain = c.custom_data.company_domain;
        if (!domain && c.custom_data.company_website) {
            try {
                domain = new URL(c.custom_data.company_website).hostname.replace('www.', '');
            } catch (e) { }
        }

        if (domain) {
            validCompanies.push({ ...c, domain });
            domains.push(domain);
        } else {
            console.log(`   ⚠️ No domain for ${c.company_name}`);
        }
    }

    console.log(`   Detailed recovery for ${validCompanies.length} domains...`);

    // 3. Prepare Payload
    // We want ~5 leads per company. 
    // Total Results = 5 * companies.
    // Apify Actor requires min 1000.
    const calculated = validCompanies.length * 5;
    const totalResults = Math.max(calculated, 1000);

    console.log(`   Requested ${totalResults} leads (adjusted for min 1000 limit).`);

    const payload = {
        companyDomains: domains,
        personTitle: [
            "Executive Director", "Director Of Operations", "Founder", "Co-Founder",
            "CEO", "President", "Vice President", "Principal", "Managing Director", "Partner"
        ],
        // Allowed: "Founder", "Chairman", "President", "CEO", "CXO", "Vice President", "Director", "Head", "Manager", "Senior", "Junior", "Entry Level", "Executive"
        seniority: ["Director", "Executive", "Founder", "CXO", "Vice President", "President", "CEO"],
        contactEmailStatus: "verified",
        includeEmails: true,
        skipLeadsWithoutEmails: true,
        totalResults: totalResults
    };

    if (domains.length === 0) {
        console.log('   ❌ No domains.');
        pool.end();
        return;
    }

    // 4. Run Scraper
    try {
        console.log(`🚀 Launching Apify Scraper for ${totalResults} leads...`);
        const runRes = await axios.post(
            `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
            payload
        );
        const runId = runRes.data.data.id;
        console.log(`   Run ID: ${runId}`);

        // Poll
        let datasetId = null;
        while (true) {
            const statusRes = await axios.get(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`);
            const status = statusRes.data.data.status;
            console.log(`   Status: ${status}`);

            if (status === 'SUCCEEDED') {
                datasetId = statusRes.data.data.defaultDatasetId;
                break;
            } else if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
                throw new Error(`Run failed: ${status}`);
            }
            await delay(5000);
        }

        // Fetch Results
        console.log('📥 Fetching Results...');
        const itemsRes = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}`);
        const results = itemsRes.data;
        console.log(`   Got ${results.length} leads.`);

        // 5. Insert Leads
        let added = 0;
        for (const lead of results) {
            const email = lead.email || (lead.emails ? lead.emails[0] : null);
            if (!email) continue;

            // Map back to our Company ID using domain
            // Note: Apify result usually has 'company' object with 'domain' or 'website'
            // We'll try to fuzzy match domain
            const leadDomain = lead.company?.domain || lead.companyDomain || '';
            const parent = validCompanies.find(c => leadDomain && (c.domain.includes(leadDomain) || leadDomain.includes(c.domain)));

            if (parent) {
                // Check dup
                const dupCheck = await pool.query(`SELECT id FROM leads WHERE email = $1`, [email]);
                if (dupCheck.rowCount === 0) {
                    // Normalize data
                    const personName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
                    const jobTitle = lead.title || lead.jobTitle || '';
                    const linkedinUrl = lead.linkedinUrl || lead.linkedin || '';

                    // Copy critical fields from Parent
                    const customData = {
                        ...parent.custom_data, // Keep profile/score
                        recovered: true,
                        original_apify_lead: lead // Backup
                    };

                    await pool.query(
                        `INSERT INTO leads (
                            company_name, person_name, job_title, email, linkedin_url, 
                            status, custom_data, icp_id, created_at
                         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                        [
                            parent.company_name, // Use inconsistent company name? Or from lead? 
                            // Use Parent Company Name to ensure grouping works in UI!
                            personName,
                            jobTitle,
                            email,
                            linkedinUrl,
                            'NEW',
                            customData,
                            parent.icp_id || null // Assuming we can get icp_id from custom_data or DB if column exists?
                            // Wait, icp_id is a column in leads table? Yes in `Companies.jsx` checks.
                            // I need to select it in step 1.
                        ]
                    );
                    added++;
                    // console.log(`      + Added ${personName} to ${parent.company_name}`);
                }
            }
        }

        console.log(`✅ RECOVERY COMPLETE. Added ${added} new leads.`);

    } catch (e) {
        console.error('❌ Error:', e.message);
        if (e.response) console.error(e.response.data);
    } finally {
        pool.end();
    }
}

main();
