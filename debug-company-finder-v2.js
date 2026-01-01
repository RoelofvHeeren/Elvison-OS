
import { performGoogleSearch } from './src/backend/services/apify.js';
import dotenv from 'dotenv';
dotenv.config();

const testHelper = async () => {
    console.log("🚀 Starting Google Search Debug...");

    // Use a token from env or hardcoded fallback if needed for local test
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        console.error("❌ No APIFY_API_TOKEN found in .env");
        process.exit(1);
    }
    console.log("🔑 Using Token:", token.substring(0, 5) + "...");

    const query = "software companies in Toronto";
    console.log(`🔎 Query: "${query}"`);

    try {
        const results = await performGoogleSearch(query, token);
        console.log(`\n✅ Results Found: ${results.length}`);

        if (results.length > 0) {
            console.log("\n--- First 3 Results ---");
            results.slice(0, 3).forEach((r, i) => {
                console.log(`\n[${i + 1}] ${r.title}`);
                console.log(`🔗 ${r.link}`);
                console.log(`📝 ${r.snippet}`);
            });
        } else {
            console.log("⚠️ No results returned by Apify.");
        }
    } catch (e) {
        console.error("❌ Search Failed:", e);
    }
};

testHelper();
