/**
 * Test Portfolio Deal Extraction System
 * 
 * This script tests the new portfolio deal extraction and message generation
 * by enriching a sample company and verifying deal-specific mentions.
 */

const { CompanyProfiler } = require('./src/backend/services/company-profiler.js');
const { query } = require('./db/index.js');

const TEST_COMPANIES = [
    {
        domain: 'forumequity.com',
        name: 'Forum Equity Partners',
        icpType: 'Investment Fund'
    },
    {
        domain: 'tricon.ca',
        name: 'Tricon Residential',
        icpType: 'Real Estate Developer'
    }
];

async function testPortfolioDealSystem() {
    console.log('=== Testing Portfolio Deal Extraction System ===\n');

    for (const company of TEST_COMPANIES) {
        console.log(`\n--- Testing: ${company.name} (${company.domain}) ---`);

        try {
            // 1. Enrich the company (this will extract deals)
            console.log(`[1/3] Enriching ${company.name}...`);
            const enrichResult = await CompanyProfiler.enrichByDomain(
                company.domain,
                company.name,
                company.icpType
            );

            if (enrichResult.status === 'failed') {
                console.error(`❌ Enrichment failed: ${enrichResult.reason}`);
                continue;
            }

            console.log(`✅ Enrichment successful (${enrichResult.contentLength} chars, ${enrichResult.pageCount} pages)`);

            // 2. Query the database to check if deals were stored
            console.log(`[2/3] Checking stored portfolio deals...`);
            const { rows } = await query(
                `SELECT custom_data FROM leads WHERE company_name ILIKE $1 LIMIT 1`,
                [`%${company.name}%`]
            );

            if (rows.length === 0) {
                console.warn(`⚠️  No leads found for ${company.name}`);
                continue;
            }

            const customData = typeof rows[0].custom_data === 'string'
                ? JSON.parse(rows[0].custom_data)
                : (rows[0].custom_data || {});

            const deals = customData.portfolio_deals || [];

            if (deals.length === 0) {
                console.warn(`⚠️  No deals extracted for ${company.name}`);
            } else {
                console.log(`✅ Extracted ${deals.length} deals:`);
                deals.slice(0, 3).forEach((deal, idx) => {
                    console.log(`   ${idx + 1}. ${deal.name}`);
                    if (deal.location) console.log(`      Location: ${deal.location}`);
                    if (deal.units) console.log(`      Units: ${deal.units}`);
                    if (deal.date) console.log(`      Date: ${deal.date}`);
                });
            }

            // 3. Test message generation with deals
            console.log(`[3/3] Testing message generation...`);
            const { OutreachService } = await import('./src/backend/services/outreach-service.js');

            const messageResult = await OutreachService.createLeadMessages({
                company_name: company.name,
                website: company.domain,
                company_profile: rows[0].company_profile || '',
                icp_type: company.icpType,
                first_name: 'John',
                person_name: 'John Smith',
                portfolio_deals: deals
            });

            if (messageResult.outreach_status === 'SUCCESS') {
                console.log(`✅ Message generated successfully!`);
                console.log(`   LinkedIn: ${messageResult.linkedin_message}`);

                // Check if message mentions specific deal
                const hasDealMention = deals.length > 0 &&
                    messageResult.linkedin_message.toLowerCase().includes(deals[0].name.toLowerCase());

                if (hasDealMention) {
                    console.log(`   🎯 DEAL-SPECIFIC MENTION DETECTED!`);
                } else {
                    console.log(`   ⚠️  Generic message (no deal mention)`);
                }
            } else {
                console.warn(`⚠️  Message generation failed: ${messageResult.outreach_reason}`);
            }

        } catch (error) {
            console.error(`❌ Error testing ${company.name}:`, error.message);
        }
    }

    console.log('\n=== Test Complete ===');
    process.exit(0);
}

testPortfolioDealSystem().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
