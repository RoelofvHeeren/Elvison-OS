
import 'dotenv/config';
import { startApolloDomainScrape } from './src/backend/services/apify.js';

async function testSeniority() {
    console.log("Testing Seniority ENUMs...");

    // Test questionable values
    const testValues = ["Partner", "Principal", "Owner", "CXO", "Senior", "Manager"];

    const domains = ["apple.com"]; // Dummy
    const filters = {
        seniority: testValues
    };

    try {
        console.log(`Sending seniority: ${JSON.stringify(testValues)}`);
        const runId = await startApolloDomainScrape(process.env.APIFY_API_TOKEN, domains, filters, "test-seniority-check-" + Date.now());
        console.log(`Success! Run ID: ${runId}. These seniority values are accepted.`);
    } catch (e) {
        console.error("Failed!", e.message);
    }
}

testSeniority();
