/**
 * FINAL ENRICHER SCRIPT
 * 
 * Target specific companies that are currently low on leads.
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

const ALLOWED_SENIORITY = ["Founder", "Chairman", "President", "CEO", "CXO", "Vice President", "Director", "Head", "Executive"];

async function main() {
    console.log('🚀 Starting Final Targeted Enrichment...\n');

    const TARGET_NAMES = [
        'Our Family Office Inc', 'Terracap Management Inc', 'Tricon Residential',
        'Tricor Pacific Capital Inc', 'Alberta Investment Management Corporation (AIMCo)',
        'Wealhouse Capital Management', 'Cameron Stephens', 'Clarion Partners LLC',
        'Equiton Inc', 'Greybrook Realty Partners', 'HOOPP (Healthcare of Ontario Pension Plan)',
        'Lankin Investments', 'Pivot Real Estate Group', 'PSP Investments', 'Spotlight Development Inc'
    ];

    const { rows: companies } = await query(`
        SELECT DISTINCT company_name, custom_data->>'company_website' as website, custom_data->>'company_domain' as domain
        FROM leads
        WHERE status != 'DISQUALIFIED'
        AND company_name = ANY($1)
    `, [TARGET_NAMES]);

    console.log(`Found ${companies.length} targets to enrich.`);

    const scraper = new LeadScraperService();

    // Process one by one for maximum focus and logging
    for (const company of companies) {
        console.log(`\n🔍 Searching for leads for: ${company.company_name} (${company.website || company.domain})`);

        const filters = {
            job_titles: REQUESTED_TITLES,
            seniority: ALLOWED_SENIORITY,
            maxResults: 10
        };

        try {
            const { leads } = await scraper.fetchLeads([company], filters);
            console.log(`   Found ${leads.length} leads.`);

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
                        VALUES ($1, $2, $3, $4, $5, 'QUALIFIED', $6, '40ac42ec-48bc-4069-864b-c47a02ed9b40')
                    `, [`${lead.first_name} ${lead.last_name}`, lead.company_name, lead.title, lead.email, lead.linkedin_url, JSON.stringify(newCustomData)]);
                    console.log(`   + Added ${lead.first_name} ${lead.last_name} (${lead.title})`);
                }
            }
        } catch (e) {
            console.error(`   ❌ Error for ${company.company_name}:`, e.message);
        }
    }

    console.log('\n✨ Final Enrichment complete.');
    process.exit();
}

main();
