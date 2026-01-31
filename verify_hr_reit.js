import { CompanyProfiler } from './src/backend/services/company-profiler.js';
import LLMOutreachGenerator from './src/backend/services/llm-outreach-generator.js'; // Default import
import { query } from './db/index.js';

console.log('=== HR-REIT Outreach Verification ===\n');

// Step 1: Deep Profile HR-REIT
console.log('[1/4] Deep Profiling HR-REIT...');
const enrichResult = await CompanyProfiler.enrichByDomain(
    'hr-reit.com',
    'H&R Real Estate Investment Trust',
    'Real Estate Investment Trust'
);

if (enrichResult.status !== 'success') {
    console.error('❌ Enrichment failed:', enrichResult.reason);
    process.exit(1);
}

// Step 2: Fetch enriched data
const res = await query(`
    SELECT company_profile, investment_thesis, custom_data 
    FROM leads 
    WHERE company_name ILIKE '%H&R%' OR company_name ILIKE '%HR%'
    ORDER BY updated_at DESC 
    LIMIT 1
`);

if (res.rows.length === 0) {
    console.error('❌ HR-REIT not found in database after enrichment');
    process.exit(1);
}

const company = res.rows[0];

console.log('\n--- EXTRACTED DATA ---');
console.log('Thesis:', company.custom_data?.investment_thesis || company.investment_thesis || 'N/A');
console.log('Deals Found:', (company.custom_data?.portfolio_deals || []).length);
console.log('Managed Funds:', (company.custom_data?.managed_funds || []).length);

if ((company.custom_data?.portfolio_deals || []).length > 0) {
    console.log('Top Deal:', company.custom_data.portfolio_deals[0]);
}

console.log('Profile Snippet:', company.company_profile.substring(0, 200) + '...\n');

// Step 3: Generate Messages for 3 Contacts
const contacts = [
    { name: 'Peter', title: 'Managing Director' },
    { name: 'Jackson', title: 'Head of Acquisitions' },
    { name: 'Amy', title: 'Director of Investments' }
];

console.log('[2/4] Generating personalized messages...\n');

for (const contact of contacts) {
    console.log(`--- MESSAGE FOR ${contact.name.toUpperCase()} (${contact.title}) ---`);

    // Correct method: .generate() and correct property mapping
    const messageResult = await LLMOutreachGenerator.generate({
        companyName: 'H&R REIT', // Shortname usually better for messages
        companyProfile: company.company_profile,
        personName: contact.name,    // Mapped from contact.name
        icpType: 'Real Estate Investment Trust',
        portfolioDeals: company.custom_data?.portfolio_deals || [],
        investmentThesis: company.custom_data?.investment_thesis || company.investment_thesis
    });

    if (messageResult) {
        console.log('\n[Reasoning]:', messageResult.reasoning);
        console.log('\n[LinkedIn Message]:');
        console.log(messageResult.linkedin_message); // Corrected property casing
        console.log('\n[Email Subject]:');
        console.log(messageResult.email_subject);
        console.log('\n[Email Body]:');
        console.log(messageResult.email_body);
        console.log('\n');
    } else {
        console.log('❌ Generation failed (Result null)');
    }
}

console.log('[3/4] Cost Analysis...');
console.log('Analyzing API usage for this audit...\n');

// Cost estimation based on Gemini Flash pricing
const estimatedInputTokens = 330000; // Research content
const estimatedOutputTokens = 3000; // Profile + extraction + 3 messages
const geminiFlashInputCost = (estimatedInputTokens / 1000000) * 0.075; // $0.075 per 1M input tokens
const geminiFlashOutputCost = (estimatedOutputTokens / 1000000) * 0.30; // $0.30 per 1M output tokens
const totalGeminiCost = geminiFlashInputCost + geminiFlashOutputCost;

console.log('--- ESTIMATED API COSTS ---');
console.log(`Gemini Flash Input: ~${estimatedInputTokens.toLocaleString()} tokens → $${geminiFlashInputCost.toFixed(4)}`);
console.log(`Gemini Flash Output: ~${estimatedOutputTokens.toLocaleString()} tokens → $${geminiFlashOutputCost.toFixed(4)}`);
console.log(`Total Gemini Cost: $${totalGeminiCost.toFixed(4)}`);
console.log(`\nApify Scraping: ~$0.01 - $0.05 (depending on page count and render needs)`);
console.log(`\nTOTAL ESTIMATED COST PER COMPANY: $${(totalGeminiCost + 0.03).toFixed(4)}`);

console.log('\n[4/4] ✅ HR-REIT Audit Complete!');
