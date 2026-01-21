import axios from 'axios';
import dotenv from 'dotenv';
import { startGoogleSearch, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

async function inspectGoogleResults() {
    try {
        console.log('🔍 Testing Google Search for LinkedIn URL extraction\n');

        // Test with Rolando Villarreal
        const searchQuery = '"Rolando Villarreal" LinkedIn San Antonio';
        console.log(`Query: ${searchQuery}\n`);

        const runId = await startGoogleSearch(
            APIFY_TOKEN,
            [searchQuery],
            { limit: 20 } // Get more results
        );

        console.log(`Run ID: ${runId}`);
        console.log('Waiting for results...\n');

        // Wait for completion
        let status = 'RUNNING';
        let attempts = 0;
        while (status === 'RUNNING' && attempts < 20) {
            await new Promise(r => setTimeout(r, 3000));
            const statusData = await checkApifyRun(APIFY_TOKEN, runId);
            status = statusData.status;
            attempts++;
        }

        if (status === 'SUCCEEDED') {
            const statusData = await checkApifyRun(APIFY_TOKEN, runId);
            const results = await getApifyResults(APIFY_TOKEN, statusData.datasetId);

            console.log(`=== FOUND ${results.length} RESULTS ===\n`);

            // Display all results
            for (let i = 0; i < Math.min(10, results.length); i++) {
                const result = results[i];
                console.log(`[${i + 1}] ${result.title || 'No title'}`);
                console.log(`    URL: ${result.url || result.link || 'N/A'}`);
                console.log(`    Description: ${(result.description || result.snippet || 'N/A').substring(0, 100)}...\n`);
            }

            // Find LinkedIn URLs
            console.log('\n=== LINKEDIN PROFILES FOUND ===\n');
            const linkedinResults = results.filter(r =>
                (r.url || r.link || '').includes('linkedin.com/in/')
            );

            if (linkedinResults.length > 0) {
                linkedinResults.forEach((r, i) => {
                    console.log(`[${i + 1}] ${r.url || r.link}`);
                    console.log(`    Title: ${r.title || 'N/A'}\n`);
                });
            } else {
                console.log('⚠️ No LinkedIn URLs found in results');
                console.log('\nFull result object structure:');
                if (results.length > 0) {
                    console.log(JSON.stringify(results[0], null, 2));
                }
            }
        } else {
            console.log(`Search failed: ${status}`);
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

inspectGoogleResults();
