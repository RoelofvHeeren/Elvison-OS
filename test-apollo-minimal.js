import 'dotenv/config';
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

// MOCK FILTER
const filters = {
    job_titles: ["CEO", "Founder", "Director"], // Example titles
    excluded_functions: ["HR", "Sales"], // Example exclusion
};

const domains = ["apple.com", "microsoft.com"]; // Known valid domains

async function runTest() {
    console.log("Starting minimal Apollo Domain test...");
    try {
        const runId = await startApolloDomainScrape(process.env.APIFY_API_TOKEN, domains, filters, "test-idempotency-key");
        console.log("Run ID:", runId);

        let isComplete = false;
        let datasetId = null;
        while (!isComplete) {
            await new Promise(r => setTimeout(r, 5000));
            const status = await checkApifyRun(process.env.APIFY_API_TOKEN, runId);
            console.log("Status:", status.status);
            if (status.status === 'SUCCEEDED') {
                isComplete = true;
                datasetId = status.datasetId;
            } else if (status.status === 'FAILED') {
                throw new Error("Run failed");
            }
        }

        if (datasetId) {
            const results = await getApifyResults(process.env.APIFY_API_TOKEN, datasetId);
            console.log(`Retrieved ${results.length} raw results.`);

            // Apply client-side filtering logic from service
            const validItems = results.filter(item => {
                const title = (item.title || item.personTitle || "").toLowerCase();
                if (filters.excluded_functions) {
                    for (const exclusion of filters.excluded_functions) {
                        if (title.includes(exclusion.toLowerCase())) return false;
                    }
                }
                return true;
            });
            console.log(`Valid items after filtering: ${validItems.length}`);
            validItems.forEach(i => console.log(`- ${i.firstName} ${i.lastName} (${i.title})`));
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
}

runTest();
