
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

import { performGoogleSearch } from '../src/backend/services/apify.js';

(async () => {
    const query = 'Canadian real estate investment firms investing in residential developments LP co-GP';
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

    console.log(`🔎 Verifying Grounded Search for: "${query}"`);
    console.log(`🔑 Using API Key: ${apiKey ? 'Present' : 'MISSING'}`);

    if (!apiKey) {
        console.error("❌ GOOGLE_API_KEY is missing. Please check .env files.");
        process.exit(1);
    }

    try {
        const results = await performGoogleSearch(query);

        console.log(`\n📊 Results Found: ${results.length}`);

        if (results.length > 0) {
            console.log("\n✅ Top 3 Results:");
            results.slice(0, 3).forEach((r, i) => {
                console.log(`${i + 1}. ${r.title}`);
                console.log(`   ${r.link}`);
                if (r.snippet) console.log(`   "${r.snippet.substring(0, 50)}..."`);
            });
            console.log("\n✅ Verification SUCCESS: Gemini Grounding is working.");
        } else {
            console.log("\n⚠️  No results found. Check Gemini logs for tool usage.");
        }

    } catch (error) {
        console.error("\n❌ Verification FAILED:", error);
    }
})();
