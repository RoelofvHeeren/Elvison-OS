
import 'dotenv/config';
import { query } from '../db/index.js';

async function backfillCompanies() {
    console.log('--- STARTING COMPANIES BACKFILL ---');
    try {
        // 1. Get unique companies from leads
        // Note: Using 'score' from custom_data as observed in workflow.js
        const { rows: leads } = await query(`
            SELECT DISTINCT ON (user_id, company_name)
                user_id,
                company_name,
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'company_profile' as company_profile,
                custom_data->>'score' as fit_score
            FROM leads
            WHERE company_name IS NOT NULL
        `);

        console.log(`Found ${leads.length} unique companies in leads table.`);

        let inserted = 0;
        let errors = 0;

        for (const lead of leads) {
            try {
                // Determine valid score (must be integer integers)
                let score = parseInt(lead.fit_score);
                if (isNaN(score)) score = null;

                // Determine valid domain/website
                const finalWebsite = lead.website || lead.domain;

                await query(`
                    INSERT INTO companies (user_id, company_name, website, company_profile, fit_score, created_at, last_updated)
                    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    ON CONFLICT (user_id, company_name) 
                    DO UPDATE SET
                        website = COALESCE(companies.website, EXCLUDED.website),
                        company_profile = COALESCE(companies.company_profile, EXCLUDED.company_profile),
                        fit_score = COALESCE(companies.fit_score, EXCLUDED.fit_score),
                        last_updated = NOW()
                `, [lead.user_id, lead.company_name, finalWebsite, lead.company_profile, score]);

                inserted++;
            } catch (err) {
                console.error(`Failed to insert ${lead.company_name}:`, err.message);
                errors++;
            }
        }

        console.log(`Backfill Complete.`);
        console.log(`Success: ${inserted}`);
        console.log(`Errors: ${errors}`);

    } catch (e) {
        console.error('Backfill failed:', e);
    } finally {
        process.exit();
    }
}

backfillCompanies();
