import { CompanyProfiler } from './src/backend/services/company-profiler.js';
import { OutreachService } from './src/backend/services/outreach-service.js';
import dotenv from 'dotenv';
dotenv.config();

async function runNicolaAudit() {
    console.log('=== Nicola Wealth Outreach Verification ===');

    const domain = 'nicolawealth.com';
    const companyName = 'Nicola Wealth';
    const icpType = 'Investment Fund'; // Assumed
    const personName = 'Peter';

    try {
        // 1. Enrich / Profile
        console.log(`\n[1/3] Deep Profiling ${companyName}...`);
        const profileResult = await CompanyProfiler.enrichByDomain(domain, companyName, icpType);

        if (profileResult.status !== 'success') {
            console.error('Enrichment failed:', profileResult);
            return;
        }

        const { company_profile, custom_data } = profileResult.data;
        const investment_thesis = custom_data.investment_thesis || "";
        const portfolioDeals = custom_data.portfolio_deals || [];

        console.log('\n--- EXTRACTED DATA ---');
        console.log('Thesis:', investment_thesis);
        console.log('Deals Found:', portfolioDeals.length);
        if (portfolioDeals.length > 0) {
            console.log('Top Deal:', portfolioDeals[0]);
        }
        console.log('Profile Snippet:', company_profile.substring(0, 150) + '...');

        // 2. Generate Message
        console.log(`\n[2/3] Generating Message for ${personName}...`);

        const messageResult = await OutreachService.createLeadMessages({
            company_name: companyName,
            website: domain,
            company_profile: company_profile,
            icp_type: icpType,
            first_name: personName,
            person_name: personName,
            portfolio_deals: portfolioDeals,
            investment_thesis: investment_thesis
        });

        console.log('\n--- FINAL OUTREACH ---');
        console.log('Status:', messageResult.outreach_status);

        if (messageResult.outreach_status === 'SUCCESS') {
            console.log('\n[LinkedIn Message]:');
            console.log(messageResult.linkedin_message);
            console.log('\n[Email Subject]:');
            console.log(messageResult.email_subject);
            console.log('\n[Email Body]:');
            console.log(messageResult.email_body);
        } else {
            console.log('Failed Reason:', messageResult.outreach_reason);
        }

    } catch (error) {
        console.error('Script Error:', error);
    }
}

runNicolaAudit();
