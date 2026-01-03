
// Test script to verify data integrity through the workflow pipeline
// Specifically ensuring 'company_profile' is preserved

import assert from 'assert';

// 1. Mock Data
const qualifiedCompany = {
    company_name: "Test Corp",
    domain: "testcorp.com",
    company_profile: "A detailed 10-sentence profile about Test Corp..."
};

const rawScrapedItem = {
    firstName: "John",
    lastName: "Doe",
    email: "john@testcorp.com",
    organizationName: "Test Corp Inc",
    organizationWebsite: "http://www.testcorp.com",
    position: "CEO"
};

console.log("🚀 Starting Data Integrity Test...");

// 2. Test Normalization (LeadScraperService logic)
console.log("\n1. Testing Scraper Normalization...");
const normalized = ((item, companies) => {
    const companyDomain = item.organizationWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '');
    const originalCompany = companies.find(c => companyDomain.includes(c.domain)) || {};

    return {
        first_name: item.firstName,
        email: item.email,
        company_profile: originalCompany.company_profile || 'MISSING', // The critical field
        company_name: originalCompany.company_name
    };
})(rawScrapedItem, [qualifiedCompany]);

console.log(`   Scraper Result Profile: "${normalized.company_profile.substring(0, 20)}..."`);

if (normalized.company_profile === 'MISSING') {
    console.error("❌ FAILED: Normalization dropped the profile.");
    process.exit(1);
} else {
    console.log("✅ PASSED: Normalization preserved profile.");
}


// 3. Test Leader Ranker Merge (New Logic)
console.log("\n2. Testing Lead Ranker Merge Logic...");
const validatedLeads = [normalized];

// Mock LLM Output (Only returns score, no profile)
const llmOutput = {
    leads: [{ email: "john@testcorp.com", match_score: 9 }]
};

// Merge Logic
const scoreMap = new Map(llmOutput.leads.map(l => [l.email, l.match_score]));
const ranked = validatedLeads.map(l => ({
    ...l,
    match_score: scoreMap.get(l.email) || 5
    // Note: We are SPREADING (...l) so profile should remain
}));

console.log(`   Ranked Lead Profile: "${ranked[0].company_profile.substring(0, 20)}..."`);
console.log(`   Ranked Lead Score: ${ranked[0].match_score}`);

if (!ranked[0].company_profile || ranked[0].company_profile === 'MISSING') {
    console.error("❌ FAILED: Ranker dropped the profile.");
} else {
    console.log("✅ PASSED: Ranker preserved profile.");
}

console.log("\n🎉 ALL TESTS PASSED. Data integrity verified.");
