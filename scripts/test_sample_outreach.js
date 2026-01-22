import { OutreachService } from '../src/backend/services/outreach-service.js';

/**
 * SAMPLE OUTREACH GENERATOR
 * Generates what a message WOULD look like for a qualified lead
 * to demonstrate quality to the user.
 */

async function generateSample() {
    console.log('\n==================================================');
    console.log('🧪 SAMPLE OUTREACH GENERATION (Mock Lead)');
    console.log('==================================================\n');

    const mockLead = {
        company_name: "Alpine Residential Partners",
        person_name: "Sarah Chen",
        company_profile: "Alpine Residential Partners is a direct real estate investment firm. We invested in Summit Heights in Austin. Our platform invests capital directly into apartment value-add projects.",
        fit_score: 95,
        icp_type: "InvestmentFirm"
    };

    console.log('INPUT LEAD:');
    console.log(`Name:    ${mockLead.person_name}`);
    console.log(`Company: ${mockLead.company_name}`);
    console.log(`Profile: ${mockLead.company_profile}\n`);

    try {
        const result = await OutreachService.createLeadMessages({
            company_name: mockLead.company_name,
            company_profile: mockLead.company_profile,
            website: "alpine-res.com",
            fit_score: mockLead.fit_score,
            icp_type: mockLead.icp_type,
            first_name: "Sarah",
            person_name: mockLead.person_name
        });

        console.log('--------------------------------------------------');
        console.log(`STATUS: ${result.outreach_status}`);

        if (result.outreach_reason) {
            console.log(`REASON: ${result.outreach_reason}`);
        }

        if (result.research_fact) {
            console.log(`FACT (${result.research_fact_type}): "${result.research_fact}"`);
        }

        console.log('\n--- LINKEDIN MESSAGE (${result.linkedin_message?.length || 0} chars) ---');
        console.log(result.linkedin_message);

        console.log('\n--- EMAIL BODY ---');
        console.log(result.email_body);
        console.log('--------------------------------------------------\n');

    } catch (err) {
        console.error('Error:', err);
    }
}

generateSample();
