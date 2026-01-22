import dotenv from 'dotenv';
import pg from 'pg';
import { LeadScraperService } from './src/backend/services/lead-scraper-service.js';
import { OutreachService } from './src/backend/services/outreach-service.js';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const TARGET_LEADS_PER_COMPANY = 10;

async function backfillLeads() {
    console.log('🔄 Starting backfill to reach 10 leads per company...\n');

    try {
        // 1. Get all companies and their current lead counts
        const companiesResult = await pool.query(`
            SELECT 
                company_name,
                company_website,
                company_domain,
                company_profile,
                COUNT(*) as current_count
            FROM leads
            GROUP BY company_name, company_website, company_domain, company_profile
            HAVING COUNT(*) < ${TARGET_LEADS_PER_COMPANY}
            ORDER BY COUNT(*) ASC
        `);

        const companies = companiesResult.rows;
        console.log(`📊 Found ${companies.length} companies needing more leads\n`);

        if (companies.length === 0) {
            console.log('✅ All companies already have 10+ leads!');
            return;
        }

        // 2. Initialize Lead Scraper
        const scraper = new LeadScraperService({
            provider: 'apify_apollo_domain',
            apifyApiKey: process.env.APIFY_API_TOKEN
        });

        // 3. Process in batches (10 companies at a time to respect Apify limits)
        const BATCH_SIZE = 10;
        let totalAdded = 0;

        for (let i = 0; i < companies.length; i += BATCH_SIZE) {
            const batch = companies.slice(i, i + BATCH_SIZE);
            console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(companies.length / BATCH_SIZE)}...`);

            // Prepare company data for scraper
            const companyData = batch.map(c => ({
                company_name: c.company_name,
                domain: c.company_domain || c.company_website,
                website: c.company_website,
                company_profile: c.company_profile
            }));

            // Define filters (same as your workflow)
            const filters = {
                job_titles: [
                    "CEO", "President", "Managing Director", "Principal",
                    "Founder", "Co-Founder", "Managing Partner", "Partner",
                    "CIO", "COO", "CFO",
                    "Executive Vice President", "Executive Director",
                    "Director of Investments", "Director of Developments",
                    "Vice President", "VP"
                ],
                excluded_functions: [
                    "Marketing", "Engineering", "Sales", "HR", "Human Resources",
                    "IT", "Information Technology", "Legal", "Audit", "Compliance",
                    "Admin", "Administrative", "Support", "Customer Success"
                ],
                maxLeads: batch.length * 10 // Request 10 per company
            };

            try {
                // Fetch leads from Apollo
                console.log(`🔍 Fetching leads for ${batch.length} companies...`);
                const { leads: newLeads } = await scraper.fetchLeads(
                    companyData,
                    filters,
                    (step, msg) => console.log(`  [${step}] ${msg}`)
                );

                console.log(`✅ Retrieved ${newLeads.length} new leads`);

                // 4. For each lead, generate outreach and insert into DB
                for (const lead of newLeads) {
                    try {
                        // Find the company's current count
                        const company = batch.find(c =>
                            c.company_name.toLowerCase() === lead.company_name.toLowerCase() ||
                            c.company_domain === lead.company_domain
                        );

                        if (!company) {
                            console.log(`⚠️  Skipping ${lead.first_name} ${lead.last_name} - company not in batch`);
                            continue;
                        }

                        // Check if we've already hit the target for this company
                        const countCheck = await pool.query(
                            'SELECT COUNT(*) FROM leads WHERE company_name = $1',
                            [company.company_name]
                        );
                        const currentCount = parseInt(countCheck.rows[0].count);

                        if (currentCount >= TARGET_LEADS_PER_COMPANY) {
                            console.log(`  ⏭️  ${company.company_name} already has ${currentCount} leads, skipping`);
                            continue;
                        }

                        // Generate outreach messages
                        const outreach = await OutreachService.createLeadMessages({
                            company_name: lead.company_name,
                            company_profile: lead.company_profile || company.company_profile,
                            person_name: `${lead.first_name} ${lead.last_name}`,
                            first_name: lead.first_name
                        });

                        // Insert lead and get ID
                        const insertResult = await pool.query(`
                            INSERT INTO leads (
                                company_name, person_name, email, job_title, linkedin_url,
                                company_website, company_domain, company_profile,
                                connection_request, email_message, email_subject,
                                status, source, created_at, updated_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
                            ON CONFLICT DO NOTHING
                            RETURNING id
                        `, [
                            lead.company_name,
                            `${lead.first_name} ${lead.last_name}`.trim(),
                            lead.email,
                            lead.title,
                            lead.linkedin_url,
                            lead.company_website,
                            lead.company_domain,
                            lead.company_profile || company.company_profile,
                            outreach.linkedin_message,
                            outreach.email_body,
                            outreach.email_subject,
                            'NEW',
                            'backfill_script'
                        ]);

                        // Link to user if inserted
                        if (insertResult.rows[0]) {
                            const newLeadId = insertResult.rows[0].id;
                            await pool.query(`
                                INSERT INTO leads_link (lead_id, parent_id, parent_type)
                                VALUES ($1, $2, 'user')
                                ON CONFLICT DO NOTHING
                            `, [newLeadId, '40ac42ec-48bc-4069-864b-c47a02ed9b40']);
                        } else {
                            // If lead existed, find it and link it just in case
                            const existingLead = await pool.query(
                                'SELECT id FROM leads WHERE email = $1',
                                [lead.email]
                            );
                            if (existingLead.rows[0]) {
                                await pool.query(`
                                    INSERT INTO leads_link (lead_id, parent_id, parent_type)
                                    VALUES ($1, $2, 'user')
                                    ON CONFLICT DO NOTHING
                                `, [existingLead.rows[0].id, '40ac42ec-48bc-4069-864b-c47a02ed9b40']);
                            }
                        }

                        totalAdded++;
                        console.log(`  ✅ Added: ${lead.first_name} ${lead.last_name} (${lead.company_name})`);

                    } catch (leadError) {
                        console.error(`  ❌ Error processing ${lead.first_name} ${lead.last_name}:`, leadError.message);
                    }
                }

            } catch (batchError) {
                console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, batchError.message);
            }

            // Small delay between batches
            if (i + BATCH_SIZE < companies.length) {
                console.log('⏳ Waiting 5 seconds before next batch...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        console.log(`\n✨ Backfill complete! Added ${totalAdded} new leads.`);

    } catch (error) {
        console.error('❌ Backfill failed:', error);
    } finally {
        await pool.end();
    }
}

backfillLeads();
