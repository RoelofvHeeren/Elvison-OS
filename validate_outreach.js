
import { OutreachService } from './src/backend/services/outreach-service.js';

const profiles = [
    {
        name: "AUM Test Co",
        icp: "InvestmentFirm",
        first_name: "John",
        profile: `We manage $2.5B AUM. We specialize in value-add multifamily investment properties.`
    },
    {
        name: "Scale Deal Co",
        icp: "InvestmentFirm",
        first_name: "Sarah",
        profile: `We have 5,000 multifamily units in our portfolio. We recently acquired Alpine Village. We are an investment firm.`
    },
    {
        name: "Thesis Co",
        icp: "InvestmentFirm",
        first_name: "Mike",
        profile: `We invest in ground-up residential development.`
    },
    {
        name: "Deal Hook Co",
        icp: "InvestmentFirm",
        first_name: "Emily",
        profile: `We acquired Skyline Tower last month. It is a 300 unit luxury condo. We are a private equity firm.`
    }
];

console.log("=== Validating V5.1 Refinements ===\n");

async function run() {
    for (const p of profiles) {
        console.log(`--- Company: ${p.name} ---`);
        const result = await OutreachService.createLeadMessages({
            company_name: p.name,
            website: "http://example.com",
            company_profile: p.profile,
            fit_score: 8,
            icp_type: p.icp,
            first_name: p.first_name,
            person_name: `${p.first_name} Smith`
        });

        if (result.outreach_status === 'SUCCESS') {
            console.log(`[SUCCESS] Fact Type: ${result.research_fact_type}`);
            console.log(`Fact: ${result.research_fact}`);
            console.log(`Message: ${result.linkedin_message}`);
        } else {
            console.log(`[${result.outreach_status}] Reason: ${result.outreach_reason}`);
        }
        console.log("\n");
    }
}

run();
