import { CompanyProfiler } from './src/backend/services/company-profiler.js';
import { query } from './db/index.js';

async function test2StageFunnel() {
    console.log("🚀 Starting 2-Stage Funnel Test...");

    // Test Case: A Real Target (Verify 10-page selection)
    const target = {
        name: "Nicola Wealth",
        domain: "nicolawealth.com",
        icp: "Investment Fund"
    };

    console.log(`\n--- Testing Robust Selection: ${target.name} ---`);
    const result = await CompanyProfiler.enrichByDomain(target.domain, target.name, target.icp);
    console.log("Final Result Status:", result.status);
    if (result.reason) console.log("Reason:", result.reason);

    console.log("\n--- Test Complete ---");
}

test2StageFunnel().catch(console.error);
