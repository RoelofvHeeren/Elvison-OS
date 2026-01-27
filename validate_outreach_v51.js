import ResearchFactExtractor from './src/backend/services/outreach/researchFactExtractor.js';
import { OutreachService } from './src/backend/services/outreach-service.js';

async function validate() {
    console.log('🧪 Starting Outreach V5.1 Validation...\n');

    const testProfiles = [
        {
            name: 'AUM Only Firm',
            icp: 'Investment Fund',
            profile: 'Wellington Management is a private firm with $1.4 trillion in Assets Under Management (AUM). We focus on global equities and fixed income. We strive to deliver excellence.',
            expectedFactType: 'THESIS', // Should NOT be SCALE (AUM excluded)
            description: 'Testing AUM exclusion from Scale'
        },
        {
            name: 'Named Deal Firm',
            icp: 'Real Estate Investor',
            profile: 'Fifth Avenue Properties recently acquired the Alpine Village apartments. We seek value-add opportunities in the residential sector.',
            expectedFactType: 'DEAL',
            contains: 'partner with LP or co-GP capital',
            description: 'Testing Deal micro-hook'
        },
        {
            name: 'Mid-sentence Pronoun Firm',
            icp: 'Real Estate Investor',
            profile: 'Our strategy is unique. Although we invest in many sectors, we focus primarily on multifamily.',
            expectedFactType: 'THESIS',
            description: 'Testing mid-sentence pronoun safety'
        }
    ];

    for (const test of testProfiles) {
        console.log(`--- Testing: ${test.name} ---`);
        console.log(`Goal: ${test.description}`);

        const factResult = ResearchFactExtractor.extract(test.profile, test.name, test.icp);
        console.log(`Fact Type: ${factResult.fact_type}`);
        console.log(`Fact: ${factResult.fact}`);

        if (test.expectedFactType && factResult.fact_type !== test.expectedFactType) {
            console.error(`❌ Expected Fact Type ${test.expectedFactType}, got ${factResult.fact_type}`);
        }

        const msgResult = await OutreachService.createLeadMessages({
            company_name: test.name,
            company_profile: test.profile,
            person_name: 'John Doe',
            icp_type: test.icp
        });

        console.log(`LinkedIn: ${msgResult.linkedin_message}`);

        if (test.contains && !msgResult.linkedin_message.includes(test.contains)) {
            console.error(`❌ Missing expected micro-hook: "${test.contains}"`);
        }

        if (test.name === 'Mid-sentence Pronoun Firm') {
            if (msgResult.linkedin_message.includes('Mid-sentence Pronoun Firm invest')) {
                console.log('✅ Correct: replaced leading pronoun');
            }
            if (msgResult.linkedin_message.includes('although Mid-sentence Pronoun Firm invest')) {
                console.error('❌ Error: replaced mid-sentence pronoun');
            }
        }

        console.log('\n');
    }

    console.log('🏁 Validation Complete.');
}

validate().catch(console.error);
