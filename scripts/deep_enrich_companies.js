import { query, pool } from '../db/index.js';
import { scanSiteStructure, scrapeSpecificPages } from '../src/backend/services/apify.js';
import { OutreachService } from '../src/backend/services/outreach-service.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * DEEP ENRICHMENT SCRIPT (Robust Mode - No AI Dependency)
 * 
 * Target: Companies with missing profiles (SKIP status leads).
 * Workflow:
 * 1. Scan Sitemap/Homepage for links.
 * 2. Select top 20 pages using Regex Keyword Filtering (Strategy, Portfolio, Team, Contact).
 * 3. Scrape those specific pages.
 * 4. Combine text into a raw profile.
 * 5. Update DB & Regenerate Leads.
 */

const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const TEST_COMPANY = process.argv.find(arg => arg.startsWith('--test='))?.split('=')[1];

if (!APIFY_TOKEN) {
    console.error('❌ Missing APIFY_API_TOKEN in .env');
    process.exit(1);
}

async function main() {
    console.log('\n==================================================');
    console.log('🚀 STARTING DEEP COMPANY ENRICHMENT (ROBUST MODE)');
    console.log('==================================================');

    if (DRY_RUN) console.log('👀 DRY RUN MODE: Will not scrape or update DB.\n');
    if (TEST_COMPANY) console.log(`🎯 TARGET MODE: Only processing "${TEST_COMPANY}"\n`);

    try {
        // 1. Fetch Target Companies
        let sql = `
            SELECT DISTINCT company_name, company_website, company_domain 
            FROM leads 
            WHERE outreach_status = 'SKIP' 
            AND (company_profile IS NULL OR company_profile = '')
            AND custom_data::text NOT LIKE '%profile%'
        `;

        if (TEST_COMPANY) {
            sql = `
                SELECT DISTINCT company_name, company_website, company_domain
                FROM leads
                WHERE company_name ILIKE $1
            `;
        }

        const { rows: companies } = await query(sql, TEST_COMPANY ? [`%${TEST_COMPANY}%`] : []);

        if (companies.length === 0) {
            console.log('✅ No companies found requiring enrichment.');
            process.exit(0);
        }

        console.log(`Found ${companies.length} companies to enrich.`);

        // 2. Process Loop
        for (const [index, company] of companies.entries()) {
            console.log(`\n--------------------------------------------------`);
            console.log(`🏢 [${index + 1}/${companies.length}] Processing: ${company.company_name}`);

            const domain = company.company_domain || company.company_website;
            if (!domain) {
                console.log('⚠️  No domain/website available. Skipping.');
                continue;
            }

            console.log(`🌍 Domain: ${domain}`);

            // A. Scan Site Structure
            console.log('📡 Scanning sitemap and links...');
            const scanResult = await scanSiteStructure(domain, APIFY_TOKEN);

            if (!scanResult || scanResult.links.length === 0) {
                console.log('⚠️  No links found. Skipping.');
                continue;
            }
            console.log(`✅ Found ${scanResult.links.length} discoverable links.`);

            // B. Page Selection (Regex-based)
            console.log('🔍 Filtering for top pages (Strategy, Portfolio, Team)...');
            const selectedUrls = selectBestPages(scanResult.links, company.company_name);
            console.log(`🎯 Selected ${selectedUrls.length} pages to scrape.`);
            if (DRY_RUN) {
                console.log('Dry Run Selected URLs:', selectedUrls);
                continue;
            }

            // C. Targeted Scrape
            console.log(`🕷️  Scraping ${selectedUrls.length} pages...`);
            const scrapedContent = await scrapeSpecificPages(selectedUrls, APIFY_TOKEN);

            if (!scrapedContent || scrapedContent.length < 500) {
                console.log('⚠️  Scrape returned insufficient content. Skipping update.');
                continue;
            }
            console.log(`✅ Scraped ${scrapedContent.length} chars of content.`);

            // D. Synthesize Profile (Concatenation)
            console.log('🧠 Building raw profile (Passing to V5 Generator)...');
            const finalProfile = synthesizeProfile(scrapedContent, company.company_name);
            console.log('📝 FINAL PROFILE PREVIEW:\n', finalProfile.substring(0, 500) + '...');

            // E. Update Database
            console.log('💾 Updating Database...');
            const updateSql = `
                UPDATE leads 
                SET 
                    company_profile = $1,
                    match_score = NULL, -- Reset so it gets recalculated if needed
                    outreach_status = 'pending' -- Reset to allow regeneration
                WHERE company_name = $2
            `;
            await query(updateSql, [finalProfile, company.company_name]);

            // F. Trigger Regeneration Immediately
            console.log('🔄 Regenerating messages for this company...');
            const { rows: leads } = await query(`SELECT * FROM leads WHERE company_name = $1`, [company.company_name]);

            for (const lead of leads) {
                let leadWebsite = '';
                try {
                    const cd = typeof lead.custom_data === 'string' ? JSON.parse(lead.custom_data) : (lead.custom_data || {});
                    leadWebsite = cd.company_website || '';
                } catch (e) { }

                const result = await OutreachService.createLeadMessages({
                    id: lead.id,
                    company_name: lead.company_name,
                    company_profile: finalProfile,
                    website: leadWebsite,
                    icp_type: '',
                });

                // Update Lead
                await query(`
                    UPDATE leads 
                    SET 
                        outreach_status = $1,
                        outreach_reason = $2,
                        linkedin_message = $3,
                        email_body = $4,
                        research_fact = $5,
                        research_fact_type = $6,
                        profile_quality_score = $7,
                        message_version = $8
                    WHERE id = $9
                `, [
                    result.outreach_status,
                    result.outreach_reason,
                    result.linkedin_message,
                    result.email_body,
                    result.research_fact,
                    result.research_fact_type,
                    Math.round(result.profile_quality_score || 0),
                    'v5.1',
                    lead.id
                ]);
                console.log(`   > Lead ${lead.person_name}: ${result.outreach_status}`);
            }
        }

        console.log('\n==================================================');
        console.log('🎉 DEEP ENRICHMENT COMPLETE');
        console.log('==================================================');

    } catch (err) {
        console.error('Fatal Error:', err);
    } finally {
        await pool.end(); // Close DB connection
    }
}

/**
 * Filter mostly likely pages using regex (Robust & Free)
 */
function selectBestPages(links, companyName) {
    if (links.length <= 15) return links; // If few links, scrape all

    // Priority 1: High value terms
    let priority = links.filter(l =>
        /about|team|people|leadership|management|portfolio|strategy|focus|invest|project|property|real\s?estate|platform/i.test(l)
    );

    // Priority 2: Exclude noise
    priority = priority.filter(l =>
        !/news|press|career|job|legal|privacy|login|signin|portal|events|media|report|download/i.test(l)
    );

    // If we have too many, limit to 40
    if (priority.length > 40) return priority.slice(0, 40);

    // If we have too few (< 3), soften filters to get at least something
    if (priority.length < 3) {
        return links.slice(0, 10);
    }

    return priority;
}

/**
 * Concatenates text cleanly for the V5 Generator
 */
function synthesizeProfile(rawText, companyName) {
    // rawText is already formatted as "--- PAGE: url ---\n content..."
    // We just limit it to avoid DB overflow, but Postgres text is huge.
    // OpenAI context window is the real limit.
    // Let's cap at 15,000 chars which is plenty for 3 pages.
    return rawText.substring(0, 15000);
}

main();
