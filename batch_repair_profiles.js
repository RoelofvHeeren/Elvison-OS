
import pg from 'pg';
import dotenv from 'dotenv';
import { ResearchService } from './src/backend/services/research-service.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// Initialize Gemini for fallback scoring if needed within ResearchService
// (ResearchService initializes its own model, so this might be redundant but good for safety)

const { Pool } = pg;

// Force use of remote connection string and SSL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const REQUIRED_SECTIONS = [
    'Summary',
    'Investment Strategy',
    'Scale & Geographic Focus',
    'Portfolio Observations',
    'Key Highlights',
    'Fit Analysis'
];

// Regex to find headers roughly matching the required sections
const PATTERNS = {
    'Summary': /(?:#|\*\*)\s*(?:Executive )?Summary/i,
    'Investment Strategy': /(?:#|\*\*)\s*Investment Strategy/i,
    'Scale & Geographic Focus': /(?:#|\*\*)\s*(?:Scale|Geo|Location)/i,
    'Portfolio Observations': /(?:#|\*\*)\s*(?:Portfolio|Deal History|Investments)/i,
    'Key Highlights': /(?:#|\*\*)\s*(?:Key )?Highlights/i,
    'Fit Analysis': /(?:#|\*\*)\s*(?:Fit Analysis|Strategic Fit|Fit)/i
};

// Targeted Globs for "Smart Quick Scan"
const TARGET_GLOBS = [
    { glob: '**/portfolio**' },
    { glob: '**/invest**' }, // matches investment, investments, investing
    { glob: '**/about**' },
    { glob: '**/team**' },
    { glob: '**/projects**' },
    { glob: '**/properties**' },
    { glob: '**/strategy**' }
];

async function repairProfiles() {
    try {
        console.log("🔍 Identifying incomplete profiles...");

        // Fetch ALL to filter locally (safest to reuse logic)
        const { rows } = await pool.query('SELECT * FROM companies ORDER BY website ASC');
        const companiesToRepair = [];

        for (const company of rows) {
            const profile = company.market_intelligence || company.company_profile || '';

            if (!profile) {
                companiesToRepair.push(company);
                continue;
            }

            let missingCount = 0;
            for (const section of REQUIRED_SECTIONS) {
                if (!PATTERNS[section].test(profile)) {
                    missingCount++;
                }
            }

            // If missing fit analysis or significantly incomplete
            if (missingCount > 0) {
                companiesToRepair.push(company);
            }
        }

        console.log(`Found ${companiesToRepair.length} companies to repair.`);

        // Limit to top 45 to stay within budget/time constraints if list is huge
        const batch = companiesToRepair.slice(0, 45);

        console.log(`⚠️ TARGETING BATCH OF ${batch.length} COMPANIES...`);
        console.log(`Budget: ~$0.05 - $0.10 per company -> ~$4.50 total max.`);

        for (let i = 0; i < batch.length; i++) {
            const company = batch[i];
            console.log(`\n---------------------------------------------------------`);
            console.log(`[${i + 1}/${batch.length}] Reparing: ${company.website} (${company.company_name})`);

            try {
                // 1. Run "Smart Quick Scan" (Targeted Full Scan)
                const token = process.env.APIFY_API_TOKEN;

                // Construct globs based on domain
                // e.g. https://www.hazelview.com -> https://www.hazelview.com/**/portfolio**
                let domain = company.website;
                if (domain.startsWith('http')) domain = new URL(domain).hostname;

                // We construct FULL URL globs
                const companyGlobs = TARGET_GLOBS.map(g => `http*://${domain}/${g.glob}`);
                // Also add root
                companyGlobs.push(`http*://${domain}`);

                console.log(`   Running targeted scan (Max 25 pages)...`);

                // Track progress simply
                const progressCallback = (stats) => process.stdout.write(`   Status: ${typeof stats === 'string' ? stats : stats.status}\r`);

                // Run Scrape
                const markdown = await ResearchService.runFullSiteScan(
                    company.website,
                    token,
                    0.20, // $0.20 Hard Limit per run (stricter safety)
                    progressCallback,
                    {
                        maxPages: 20,
                        maxDepth: 3, // Shallow crawl to prevent rabbit holes
                        maxConcurrency: 5, // Low concurrency to strictly respect page limit
                        globs: companyGlobs
                    }
                );

                // Note: ResearchService returns string (raw markdown usually? Or synthesis?)
                // Wait, runFullSiteScan returns the scraped content string?
                // Let's check apify.js -> scrapeFullSite returns `results.join('\n\n')` (raw markdown items joined)
                // Correct.

                if (!markdown || markdown.length < 100) {
                    console.log(`\n   ❌ Scrape returned insufficient data. Skipping synthesis.`);
                    continue;
                }

                console.log(`\n   ✅ Scrape complete. Items length: ${markdown.length} chars.`);

                // 2. Synthesize
                console.log(`   🧠 Synthesizing 6-section report...`);
                // We need to split markdown back into array for synthesizeFullScanReport
                // Actually synthesizeFullScanReport expects array of objects { text: ... } or string?
                // Inspecting research-service.js: synthesizeFullScanReport(items, ...) where items is array.
                // scrapeFullSite returns joined string.

                // Fix: We need to parse the returned string back or modify scrapeFullSite to return array.
                // Modifying scrapeFullSite is risky for other consumers.
                // Let's just mock the items array.
                // SPLIT by '--- PAGE:' separator used in `getApifyResults`?
                // Actually `getApifyResults` returns array. `scrapeFullSite` joins it. 
                // Use a quick regex split or treat as one giant item.
                const mockItems = [{ text: markdown, url: company.website }];

                const report = await ResearchService.synthesizeFullScanReport(
                    mockItems,
                    company.company_name,
                    (msg) => console.log(`   🧠 ${msg}`)
                );

                // 3. Update Database
                console.log(`   💾 Saving to DB...`);

                // Calculate Fit Score (Simple logic: High=9, Med=7, Low=4)
                let newFitScore = company.fit_score || 0;
                if (report.includes('High fit')) newFitScore = 9;
                else if (report.includes('Medium fit') || report.includes('Good fit')) newFitScore = 7;
                else if (report.includes('Low fit') || report.includes('Poor fit')) newFitScore = 4;

                await pool.query(
                    `UPDATE companies 
                     SET market_intelligence = $1, 
                         fit_score = $2,
                         last_researched_at = NOW() 
                     WHERE id = $3`,
                    [report, newFitScore, company.id]
                );

                console.log(`   ✅ Complete! Fit Score: ${newFitScore}`);

            } catch (err) {
                console.error(`\n   ❌ Failed to repair ${company.website}: ${err.message}`);
            }

            // Pause 2s to not hammer Apify/DB
            await new Promise(r => setTimeout(r, 2000));
        }

    } catch (e) {
        console.error('Batch Repair failed:', e);
    } finally {
        await pool.end();
    }
}

repairProfiles();
