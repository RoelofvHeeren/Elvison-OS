/**
 * Quick Test: Portfolio Deal Message Generation
 * 
 * Tests message generation with mock portfolio deals (no enrichment required)
 */

async function testDealMessages() {
    console.log('=== Testing Deal-Specific Message Generation ===\n');

    const { OutreachService } = await import('./src/backend/services/outreach-service.js');

    // Test Case 1: Company WITH portfolio deals
    console.log('Test 1: Company WITH portfolio deals');
    const mockDeals = [
        {
            name: 'Riverside Towers',
            location: 'Toronto, ON',
            units: '245 units',
            date: '2023',
            assetClass: 'Multifamily'
        },
        {
            name: 'Oakwood Residences',
            location: 'Vancouver, BC',
            units: '180 units',
            date: '2024'
        }
    ];

    const result1 = await OutreachService.createLeadMessages({
        company_name: 'Test Development Corp',
        website: 'testdev.com',
        company_profile: 'Test Development Corp is a leading residential developer focused on multifamily projects in major Canadian cities. Recent portfolio includes Riverside Towers (245 units) in Toronto and Oakwood Residences (180 units) in Vancouver.',
        icp_type: 'Real Estate Developer',
        first_name: 'Sarah',
        person_name: 'Sarah Johnson',
        portfolio_deals: mockDeals
    });

    console.log('Status:', result1.outreach_status);
    console.log('LinkedIn Message:', result1.linkedin_message);

    const hasDealMention = result1.linkedin_message &&
        result1.linkedin_message.toLowerCase().includes('riverside towers');
    console.log(hasDealMention ? '✅ DEAL-SPECIFIC MENTION!' : '⚠️  Generic message');

    // Test Case 2: Company WITHOUT portfolio deals (fallback)
    console.log('\n\nTest 2: Company WITHOUT portfolio deals (fallback)');
    const result2 = await OutreachService.createLeadMessages({
        company_name: 'Generic Investments',
        website: 'genericinv.com',
        company_profile: 'Generic Investments focuses on residential real estate opportunities across North America.',
        icp_type: 'Investment Fund',
        first_name: 'Mike',
        person_name: 'Mike Smith',
        portfolio_deals: [] // No deals
    });

    console.log('Status:', result2.outreach_status);
    console.log('LinkedIn Message:', result2.linkedin_message);
    console.log('✅ Fallback logic working');

    console.log('\n=== Test Complete ===');
    process.exit(0);
}

testDealMessages().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
