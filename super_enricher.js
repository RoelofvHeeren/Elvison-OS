/**
 * SUPER ENRICHER SCRIPT
 * 
 * Target ALL companies with a focus on EXACT TITLES requested by user.
 * Limit results to ensure relevance.
 */

import dotenv from 'dotenv';
dotenv.config();
import { query } from './db/index.js';
import { LeadScraperService } from './src/backend/services/lead-scraper-service.js';

const REQUESTED_TITLES = [
    "CEO", "Founder", "Co-Founder", "Owner", "Principal",
    "Founding Partner", "Managing Partner", "Partner",
    "Director of Investments", "Director of Developments",
    "Vice President", "President", "CIO", "COO"
];

async function main() {
    console.log('🚀 Starting Super Enrichment...\n');

    const { rows: companies } = await query(`
        SELECT DISTINCT company_name, custom_data->>'company_website' as website, custom_data->>'company_domain' as domain
        FROM leads
        WHERE status != 'DISQUALIFIED'
    `);

    console.log(`Found ${companies.length} companies to enrich.`);

    const scraper = new LeadScraperService();

    // Using a smaller batch size (1 per run if needed for best quality, but let's try 5)
    const BATCH_SIZE = 5;

    for (let i = 0; i < companies.length; i += BATCH_SIZE) {
        const batch = companies.slice(i, i + BATCH_SIZE).map(c => ({
            company_name: c.company_name,
            website: c.website || c.domain,
            domain: c.domain || c.website
        }));

        console.log(`\nBatch ${i / BATCH_SIZE + 1}: Searching for leads for: ${batch.map(c => c.company_name).join(', ')}`);

        const filters = {
            job_titles: REQUESTED_TITLES,
            seniority: ["c_suite", "executive", "owner", "partner", "vp", "director"],
            maxResults: 20 // 4 per company * 5 companies
        };

        try {
            const { leads } = await scraper.fetchLeads(batch, filters);
            console.log(`Found ${leads.length} leads.`);

            for (const lead of leads) {
                // Get existing metadata (profile, score)
                const { rows: existing } = await query(
                    "SELECT custom_data FROM leads WHERE (company_name ILIKE $1 OR custom_data->>'company_domain' ILIKE $2) LIMIT 1",
                    [lead.company_name, lead.company_domain]
                );

                const baseCustomData = existing[0]?.custom_data || {};
                const newCustomData = {
                    ...baseCustomData,
                    ...lead,
                    fit_score: baseCustomData.fit_score || baseCustomData.score // Preserve scores
                };

                const { rows: leadExists } = await query("SELECT id FROM leads WHERE email = $1", [lead.email]);

                if (leadExists.length === 0 && lead.email) {
                    await query(`
                        INSERT INTO leads (person_name, company_name, job_title, email, linkedin_url, status, custom_data, user_id)
                        VALUES ($1, $2, $3, $4, $5, 'QUALIFIED', $6, '00000000-0000-0000-0000-000000000000')
                    `, [`${lead.first_name} ${lead.last_name}`, lead.company_name, lead.title, lead.email, lead.linkedin_url, JSON.stringify(newCustomData)]);
                    console.log(`   + Added ${lead.first_name} ${lead.last_name} (${lead.title}) at ${lead.company_name}`);
                }
            }
        } catch (e) {
            console.error(`Error in batch:`, e.message);
        }
    }

    console.log('\n✨ Super Enrichment complete.');
    process.exit();
}

main();
