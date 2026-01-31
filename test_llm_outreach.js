import { OutreachService } from './src/backend/services/outreach-service.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Test script to verify LLM-generated outreach messages
 */
async function testLLMOutreach() {
    console.log('=== Testing LLM Outreach Generation ===');

    const mockCompany = {
        company_name: "Apex Capital Partners",
        website: "apexcapital.com",
        icp_type: "Investment Fund",
        company_profile: "Apex Capital Partners is a leading real estate private equity firm focused on acquiring value-add multifamily properties in the Southeast US. They target assets with operational upside and have deployed over $500M in equity.",
        investment_thesis: "Apex Capital targets Class B/C multifamily assets in high-growth Sun Belt markets. They look for 1980s+ vintage properties with renovation potential.",
        portfolio_deals: [
            {
                name: "The Highland Reserve",
                units: "320",
                location: "Charlotte, NC",
                date: "2024"
            }
        ],
        custom_data: {
            portfolio_deals: [
                {
                    name: "The Highland Reserve",
                    units: "320",
                    location: "Charlotte, NC",
                    date: "2024"
                }
            ]
        }
    };

    console.log(`\nTarget: ${mockCompany.company_name}`);
    console.log(`Thesis: ${mockCompany.investment_thesis}`);
    console.log(`Deal: ${mockCompany.portfolio_deals[0].name}`);

    try {
        const result = await OutreachService.createLeadMessages({
            company_name: mockCompany.company_name,
            website: mockCompany.website,
            company_profile: mockCompany.company_profile,
            icp_type: mockCompany.icp_type,
            first_name: "James",
            person_name: "James Smith",
            portfolio_deals: mockCompany.portfolio_deals,
            investment_thesis: mockCompany.investment_thesis
        });

        console.log('\n=== RESULT ===');
        console.log('Status:', result.outreach_status);
        if (result.outreach_status === 'SUCCESS') {
            console.log('Version:', result.message_version);
            console.log('\n[LinkedIn Message]:');
            console.log(result.linkedin_message);
            console.log('\n[Email Subject]:');
            console.log(result.email_subject);
            console.log('\n[Email Body]:');
            console.log(result.email_body);
        } else {
            console.log('Reason:', result.outreach_reason);
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

testLLMOutreach();
