import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import { scrapeCompanyWebsite } from './src/backend/services/apify.js';
import { GeminiModel } from './src/backend/services/gemini.js';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const COMPANIES_TO_REPROFILE = [
    'Harrison Street',
    'Sagard Real Estate',
    'Canderel',
    'Triovest',
    'Nicola Institutional Realty Advisors (NIRA)',
    'Starlight Capital',
    'Osmington Inc',
    'Thor Equities Group',
    'Wealhouse Capital Management',
    'Adams Street Partners',
    'Gordon Brothers'
];

async function reprofileCompanies() {
    console.log('🔄 Re-profiling 11 mid-market companies...\n');

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const apifyToken = process.env.APIFY_API_TOKEN;
    const gemini = new GeminiModel(apiKey, 'gemini-2.0-flash');

    let updated = 0;
    let failed = 0;

    for (const companyName of COMPANIES_TO_REPROFILE) {
        try {
            console.log(`\n📍 ${companyName}`);

            // Get current company data
            const { rows: [company] } = await pool.query(
                'SELECT website, company_profile FROM companies WHERE company_name = $1',
                [companyName]
            );

            if (!company || !company.website) {
                console.log('  ⚠️  No website found, skipping');
                failed++;
                continue;
            }

            console.log(`  🌐 Scraping ${company.website}...`);

            // Scrape website for fresh data
            const websiteContent = await scrapeCompanyWebsite(company.website, apifyToken);

            if (!websiteContent || websiteContent.length < 200) {
                console.log('  ⚠️  Scrape failed or returned minimal content');
                failed++;
                continue;
            }

            console.log(`  ✅ Scraped ${websiteContent.length} characters`);
            console.log('  🤖 Generating residential-focused profile...');

            // Generate new profile with residential focus
            const prompt = `
You are analyzing a real estate investment firm's website to create a profile focused on RESIDENTIAL real estate activity.

Company: ${companyName}
Website Content:
"""
${websiteContent.substring(0, 15000)}
"""

TASK: Create a concise company profile (300-500 words) that:
1. **MUST mention residential/multifamily/apartment activity if it exists**
2. Highlights specific residential deals, projects, or portfolio holdings
3. Describes their residential investment strategy and geography
4. Mentions deal size ranges if available

CRITICAL: If this company does NOT have residential real estate activity, state "NO RESIDENTIAL FOCUS FOUND" and explain what they actually do.

Format as markdown with sections: Summary, Strategy, Scale/Geography, Highlights.
`;

            const response = await gemini.getResponse({ input: prompt });
            const outputItem = response.output.find(i => i.type === 'message');
            const newProfile = outputItem?.content?.[0]?.text;

            if (!newProfile) {
                console.log('  ❌ Profile generation failed');
                failed++;
                continue;
            }

            // Check if residential keywords are present
            const hasResidential = /residential|multifamily|multi-family|apartment|housing|condo/i.test(newProfile);

            if (!hasResidential) {
                console.log('  ⚠️  No residential keywords found in new profile');
                console.log('  Profile preview:', newProfile.substring(0, 200) + '...');
                failed++;
                continue;
            }

            // Update database
            await pool.query(
                'UPDATE companies SET company_profile = $1 WHERE company_name = $2',
                [newProfile, companyName]
            );

            console.log('  ✅ Profile updated with residential keywords');
            updated++;

        } catch (error) {
            console.error(`  ❌ Error: ${error.message}`);
            failed++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 RE-PROFILING COMPLETE');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`✅ Successfully updated: ${updated} companies`);
    console.log(`❌ Failed: ${failed} companies\n`);

    await pool.end();
}

reprofileCompanies();
