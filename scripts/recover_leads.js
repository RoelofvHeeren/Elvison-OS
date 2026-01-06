
import { LeadScraperService } from '../src/backend/services/lead-scraper-service.js';
import { WORKFLOW_CONFIG } from '../src/config/workflow.js';

async function recoverLeads() {
    console.log('🚀 Starting Lead Recovery Script...');

    // Fallback for local dev if env vars are missing
    if (!process.env.DATABASE_URL && !process.env.DATABASE_PUBLIC_URL) {
        process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:51214/postgres";
        console.log("DEBUG: Using local fallback URL (port 51214):", process.env.DATABASE_URL);
    }

    try {
        // DYNAMIC IMPORT: Ensure DATABASE_URL is set BEFORE initializing the pool
        const { query: dbQuery } = await import('../db/index.js');

        // 1. Get User ID by email
        const userRes = await dbQuery("SELECT id FROM users WHERE email = 'roelof@elvison.com'");
        if (userRes.rows.length === 0) {
            console.error('❌ User roelof@elvison.com not found.');
            return;
        }
        const userId = userRes.rows[0].id;
        console.log(`✅ Using User ID: ${userId}`);

        // 2. Find companies with 1 or fewer leads in the CRM
        const res = await dbQuery(`
            SELECT company_name, 
                   custom_data->>'company_domain' as domain,
                   custom_data->>'icp_id' as icp_id,
                   count(*) as current_leads
            FROM leads
            WHERE user_id = $1
            GROUP BY company_name, custom_data->>'company_domain', custom_data->>'icp_id'
            HAVING count(*) <= 1
            ORDER BY current_leads ASC
        `, [userId]);

        const companies = res.rows;
        console.log(`Found ${companies.length} companies with low lead counts.`);

        if (companies.length === 0) {
            console.log('✅ All companies have enough leads. Exiting.');
            return;
        }

        const leadScraper = new LeadScraperService();

        // Target: Get 5-10 leads per company
        const filters = {
            maxLeads: 10,
            idempotencyKey: `recovery_${Date.now()}`
        };

        const logStep = (step, detail) => console.log(`[${step}] ${detail}`);
        const checkCancellation = async () => false;

        // Process in batches of 5 to avoid overloading/cost spikes
        const BATCH_SIZE = 5;
        for (let i = 0; i < companies.length; i += BATCH_SIZE) {
            const batch = companies.slice(i, i + BATCH_SIZE);
            console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} companies)...`);

            const companiesToScrape = batch.map(c => ({
                company_name: c.company_name,
                domain: c.domain
            }));

            try {
                const scrapeResult = await leadScraper.fetchLeads(companiesToScrape, filters, logStep, checkCancellation);
                const leadsFound = scrapeResult.leads || (Array.isArray(scrapeResult) ? scrapeResult : []);

                console.log(`✅ Found ${leadsFound.length} new leads for this batch.`);

                // Save to DB with validation
                const BLOCKED_EMAIL_DOMAINS = [
                    'linktr.ee', 'linktree.com', 'example.com', 'test.com',
                    'temp-mail.org', 'bio.link', 'beacons.ai', 'stan.store', 'carrd.co'
                ];
                let savedCount = 0;
                let rejectedCount = 0;

                for (const lead of leadsFound) {
                    try {
                        // === VALIDATION GATE ===
                        const emailDomain = lead.email?.split('@')[1]?.toLowerCase();
                        if (!lead.email || !emailDomain) {
                            console.log(`  ❌ Skipping lead without email`);
                            rejectedCount++;
                            continue;
                        }
                        if (BLOCKED_EMAIL_DOMAINS.includes(emailDomain)) {
                            console.log(`  ❌ Blocked email domain: ${emailDomain}`);
                            rejectedCount++;
                            continue;
                        }
                        if (!lead.company_name || lead.company_name === 'Unknown') {
                            console.log(`  ❌ Missing company_name for ${lead.email}`);
                            rejectedCount++;
                            continue;
                        }

                        const exists = await dbQuery("SELECT id FROM leads WHERE email = $1 AND user_id = $2", [lead.email, userId]);
                        if (exists.rows.length > 0) continue;

                        await dbQuery(`
                            INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, source, user_id, custom_data)
                            VALUES($1, $2, $3, $4, $5, 'NEW', 'Lead Recovery', $6, $7)
                        `, [
                            lead.company_name,
                            `${lead.first_name} ${lead.last_name}`,
                            lead.email,
                            lead.title,
                            lead.linkedin_url,
                            userId,
                            {
                                icp_id: batch.find(b => b.company_name === lead.company_name)?.icp_id,
                                score: lead.match_score || 7,
                                company_profile: lead.company_profile,
                                company_website: lead.company_website || lead.company_domain,
                                company_domain: lead.company_domain
                            }
                        ]);
                        savedCount++;
                    } catch (e) {
                        console.error(`Failed to save recovered lead ${lead.email}:`, e.message);
                    }
                }
                console.log(`✅ Saved ${savedCount} leads, Rejected ${rejectedCount} at gate.`);
            } catch (err) {
                console.error(`Batch ${i} failed:`, err.message);
            }

            // Small delay between batches
            await new Promise(r => setTimeout(r, 2000));
        }

        console.log('\n✨ Lead Recovery Complete!');
    } catch (err) {
        console.error('Fatal Error in Lead Recovery:', err);
    }
}

recoverLeads();
