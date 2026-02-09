
import { scanSiteStructure, scrapeSpecificPages } from '../src/backend/services/apify.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

const COMPANY_NAME = "Brookfield Asset Management";
const DOMAIN = "brookfield.com";
const TARGET_FOCUS = "Residential Real Estate Investments";
const RELEVANT_KEYWORDS = ["residential", "housing", "multifamily", "single-family", "apartments", "condos", "living", "real estate", "communities"];

async function main() {
    console.log(`🚀 Starting Custom Profiling for ${COMPANY_NAME} (${DOMAIN})...`);
    console.log(`🎯 Focus: ${TARGET_FOCUS}`);

    try {
        // --- STEP 1: SCAN SITEMAP ---
        console.log(`\n1️⃣  Scanning sitemap for ${DOMAIN}...`);
        const scanResult = await scanSiteStructure(DOMAIN);
        const allLinks = scanResult.links || [];
        console.log(`   Found ${allLinks.length} total links.`);

        if (allLinks.length === 0) {
            console.error("❌ No links found. Exiting.");
            return;
        }

        // --- STEP 2: SELECT RELEVANT LINKS (LLM) ---
        console.log(`\n2️⃣  Filtering links for "${TARGET_FOCUS}"...`);

        // Simple heuristic first to reduce token usage
        const potentialLinks = allLinks.filter(l =>
            RELEVANT_KEYWORDS.some(k => l.toLowerCase().includes(k)) ||
            /portfolio|investments|strategy|properties|projects/i.test(l)
        );

        console.log(`   Pre-filtered to ${potentialLinks.length} potential links based on keywords.`);

        const promptFilter = `
        You are a Real Estate Investment Researcher.
        
        Goal: Select links from the list below that are MOST likely to contain specific information about "${TARGET_FOCUS}" (Housing, Multifamily, Residential, etc.).
        We need specific portfolio details, investment strategy, and recent deals in this sector.
        
        Base Domain: ${DOMAIN}
        
        Links:
        ${potentialLinks.slice(0, 300).join('\n')}
        
        Return a JSON object with a property "selected_urls" containing the top 10-15 most relevant URLs.
        `;

        let selectedUrls = [];
        try {
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: promptFilter }] }],
                generationConfig: { responseMimeType: 'application/json' }
            });
            const response = JSON.parse(result.response.text());
            selectedUrls = response.selected_urls || [];
        } catch (e) {
            console.error("   ⚠️ LLM Filtering failed, using keyword fallback.");
            selectedUrls = potentialLinks.slice(0, 5);
        }

        console.log(`   Selected ${selectedUrls.length} links for scraping:`);
        selectedUrls.forEach(l => console.log(`   - ${l}`));

        // --- STEP 3: SCRAPE CONTENT ---
        console.log(`\n3️⃣  Scraping selected pages...`);
        const apifyToken = process.env.APIFY_API_TOKEN;
        if (!apifyToken) {
            console.error("❌ Missing APIFY_API_TOKEN in .env");
            return;
        }

        const scrapedContent = await scrapeSpecificPages(selectedUrls, apifyToken);
        console.log(`   Scraped ${scrapedContent.length} characters of content.`);

        // --- STEP 4: GENERATE PROFILE ---
        console.log(`\n4️⃣  Generating Company Profile...`);

        const promptProfile = `
        You are a Senior Investment Analyst preparing a briefing for our Sales Team.
        
        Target Company: ${COMPANY_NAME}
        Our Goal: We want to pitch them on a deal similar to their past "Residential Real Estate" investments.
        
        Task: Create a Company Profile based on the scraped content below.
        
        The profile must include:
        1. **Summary**: Brief overview of the company, AUM, and strict classification (e.g. Principal Investor, REIT, etc).
        2. **Residential Real Estate Focus**: SPECIFICALLY what they invest in within the residential sector (Multifamily, Single Family Rental, Student Housing, etc.).
        3. **Portfolio Highlights**: Extract specific names of residential assets, portfolios, or companies they have acquired (e.g. "Acquired X for $Y"). This is CRITICAL.
        4. **Geographic Focus**: Where they buy residential assets.
        5. **Investment Strategy/Thesis**: How they approach value creation in this sector (e.g. "Buy and fix", "Development", "Long-term hold").
        6. **Recent Activity**: Any recent news/deals mentioned.
        
        Tone: Professional, insightful, research-backed.
        
        Scraped Content:
        ${scrapedContent.substring(0, 50000)}
        `;

        const profileResult = await model.generateContent(promptProfile);
        const finalProfile = profileResult.response.text();

        console.log(`\n✅ Profile Generated:\n`);
        console.log(finalProfile);

        // Save to file for the agent to read
        fs.writeFileSync('brookfield_custom_profile.md', finalProfile);
        console.log(`\nSaved profile to brookfield_custom_profile.md`);

    } catch (error) {
        console.error("❌ Error running script:", error);
    }
}

main();
