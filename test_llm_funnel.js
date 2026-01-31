/**
 * Test LLM Funnel Profiler
 * 
 * Verifies the end-to-end flow of the new intelligent 3-stage funnel:
 * 1. Filter sitemap (LLM)
 * 2. Extract structured facts (LLM)
 * 3. Generate company profile (LLM)
 * 4. Generate outreach message (Deal-driven)
 */

import { CompanyProfiler } from './src/backend/services/company-profiler.js';
import { OutreachService } from './src/backend/services/outreach-service.js';
import { query } from './db/index.js';

const TEST_COMPANY = {
    domain: 'forumequity.com',
    name: 'Forum Equity Partners',
    icpType: 'Investment Fund'
};

async function testLLMFunnel() {
    console.log('=== Testing LLM Funnel Profiler System ===\n');
    console.log(`Target: ${TEST_COMPANY.name} (${TEST_COMPANY.domain})\n`);

    try {
        // 1. Run Enrichment (uses LLMFunnelProfiler internally)
        console.log('[1/4] Running Enrichment via CompanyProfiler...');
        const enrichResult = await CompanyProfiler.enrichByDomain(
            TEST_COMPANY.domain,
            TEST_COMPANY.name,
            TEST_COMPANY.icpType
        );

        if (enrichResult.status === 'failed') {
            console.error(`❌ Enrichment failed: ${enrichResult.reason}`);
            process.exit(1);
        }
        console.log(`✅ Enrichment successful (${enrichResult.contentLength} chars)`);

        // 2. Verify Database Storage
        console.log('\n[2/4] Verifying Database Storage...');
        const { rows } = await query(
            `SELECT investment_thesis, custom_data, company_profile 
             FROM leads 
             WHERE company_name ILIKE $1 
             LIMIT 1`,
            [`%${TEST_COMPANY.name}%`]
        );

        if (rows.length === 0) {
            console.error('❌ Lead not found in database');
            process.exit(1);
        }

        const lead = rows[0];
        const customData = lead.custom_data || {};
        const deals = customData.portfolio_deals || [];
        const news = customData.recent_news || [];

        console.log(`\n🔍 Extracted Data:`);
        console.log(`Investment Thesis: "${lead.investment_thesis || 'N/A'}"`);
        console.log(`Deals Found: ${deals.length}`);

        if (deals.length > 0) {
            console.log('Sample Deals:');
            deals.slice(0, 3).forEach((d, i) => console.log(`  ${i + 1}. ${d.name} (${d.location || 'N/A'}, ${d.units || 'N/A'})`));
        }

        // 3. Verify Profile Quality
        console.log(`\n[3/4] Verifying Company Profile...`);
        const profileStart = lead.company_profile.substring(0, 200).replace(/\n/g, ' ');
        console.log(`Profile Preview: "${profileStart}..."`);

        if (lead.company_profile.includes('Forum Equity Partners')) {
            console.log('✅ Profile generated successfully');
        } else {
            console.warn('⚠️  Profile might be empty or generic');
        }

        // 4. Test Outreach Generation (with new structured data)
        console.log(`\n[4/4] Generating Outreach Message...`);

        const messageResult = await OutreachService.createLeadMessages({
            company_name: TEST_COMPANY.name,
            website: TEST_COMPANY.domain,
            company_profile: lead.company_profile, // Now contains synthesized profile
            icp_type: TEST_COMPANY.icpType,
            first_name: 'David',
            person_name: 'David Smith',
            portfolio_deals: deals // Passing the extracted deals
        });

        if (messageResult.outreach_status === 'SUCCESS') {
            console.log(`\n✅ Generated Message:`);
            console.log(`LinkedIn: "${messageResult.linkedin_message}"`);

            // Check for deal mention
            if (deals.length > 0 && messageResult.linkedin_message.includes(deals[0].name)) {
                console.log('🎯 SUCCESS: Message mentions top deal!');
            } else if (lead.investment_thesis && messageResult.linkedin_message.includes('focus on')) {
                console.log('✅ SUCCESS: Message uses investment thesis (fallback)');
            } else {
                console.log('ℹ️  Message uses standard template');
            }
        } else {
            console.error(`❌ Message generation failed: ${messageResult.outreach_reason}`);
        }

    } catch (error) {
        console.error('❌ Fatal Test Error:', error);
        process.exit(1);
    }

    console.log('\n=== Test Complete ===');
    process.exit(0);
}

testLLMFunnel();
