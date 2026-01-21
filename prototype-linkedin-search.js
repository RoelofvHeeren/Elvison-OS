
import dotenv from 'dotenv';
import { startLinkedInPeopleSearch, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

async function runPrototype() {
    try {
        console.log('🚀 Starting LinkedIn Retail Investor Search Prototype...');

        const keywords = [
            "Real Estate Investor",
            "Property Investor",
            "Private Real Estate Investor"
        ];

        const options = {
            limit: 10, // Small limit for testing
            location: "United States"
        };

        const runId = await startLinkedInPeopleSearch(APIFY_TOKEN, keywords, options);

        if (!runId) {
            console.error('❌ Failed to start LinkedIn search');
            return;
        }

        console.log(`📊 Run ID: ${runId}`);

        let status = 'RUNNING';
        let datasetId = null;
        let attempts = 0;
        const MAX_ATTEMPTS = 60; // 5 mins max

        while (status === 'RUNNING' && attempts < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 5000));
            attempts++;

            const check = await checkApifyRun(APIFY_TOKEN, runId);
            status = check.status;
            datasetId = check.datasetId;

            process.stdout.write(`\r⏳ Status: ${status} (${attempts * 5}s elapsed)...`);

            if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
                break;
            }
        }

        console.log(`\n✅ Run Result: ${status}`);

        if (status === 'SUCCEEDED' && datasetId) {
            console.log(`📥 Fetching results from dataset ${datasetId}...`);
            const results = await getApifyResults(APIFY_TOKEN, datasetId);
            console.log(`📊 Profiles found: ${results.length}`);

            // Log first few results to inspect format
            results.slice(0, 3).forEach((profile, i) => {
                console.log(`\n--- Profile ${i + 1} ---`);
                console.log(`Name: ${profile.fullName || profile.name}`);
                console.log(`Title: ${profile.title || profile.headline}`);
                console.log(`Company: ${profile.companyName || profile.currentCompany?.name}`);
                console.log(`Bio: ${(profile.about || profile.summary || "").substring(0, 100)}...`);
                console.log(`LinkedIn: ${profile.url || profile.linkedinUrl}`);
                console.log(`Website: ${profile.website || profile.personalWebsite}`);
            });

            console.log('\n✅ Prototype Finished');
        } else {
            console.error('\n❌ Search failed or timed out');
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

runPrototype();
