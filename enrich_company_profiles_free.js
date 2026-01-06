/**
 * Company Profile Enrichment Script (FREE - No Apify)
 * 
 * Uses simple fetch + Gemini Flash to scrape and profile companies.
 * No Apify costs - just Gemini API calls.
 * 
 * Usage: DATABASE_URL="your-neon-url" node enrich_company_profiles_free.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const { Pool } = pg;

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Simple in-house website scraper using fetch
async function scrapeWebsite(url) {
    try {
        console.log(`   📡 Fetching: ${url}`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.log(`   ⚠️ HTTP ${response.status}`);
            return null;
        }

        const html = await response.text();

        // Simple HTML to text conversion - strip tags, keep content
        const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
            .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 12000); // Limit to ~12k chars

        console.log(`   ✅ Fetched ${text.length} chars`);
        return text;

    } catch (e) {
        if (e.name === 'AbortError') {
            console.log(`   ⚠️ Timeout`);
        } else {
            console.log(`   ⚠️ Fetch failed: ${e.message}`);
        }
        return null;
    }
}

async function generateProfile(companyName, domain, scrapedContent) {
    const prompt = `You are a company research analyst. Based on the following website content, create a DETAILED company profile.

COMPANY: ${companyName}
DOMAIN: ${domain}

WEBSITE CONTENT:
${scrapedContent || 'No content available - use your knowledge about this company if you know them.'}

Create a profile (4-10 sentences) that includes:
1. What the company does (core business, niche)
2. Size/Scale (AUM, employees, projects, founded date) - use specific numbers if available
3. Geographic focus
4. Investment focus areas / key services
5. Notable deals, achievements, or partnerships
6. Why they might be a good fit for real estate development partnerships

Also rate this company 1-10 for fit as a real estate investment partner:
- 10: Perfect - actively invests in residential real estate
- 7-9: Strong fit - invests in real estate or related sectors
- 4-6: Potential - financial services but not clear real estate focus
- 1-3: Poor fit - not relevant to real estate investing

OUTPUT FORMAT (JSON):
{
    "company_profile": "Your 4-10 sentence profile here...",
    "fit_score": 8,
    "fit_reason": "Brief reason for the score"
}`;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Extract JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { company_profile: text, fit_score: 5, fit_reason: 'Could not parse structured response' };
    } catch (e) {
        console.log(`   ⚠️ Profile generation failed: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('🚀 Company Profile Enrichment Script (FREE - No Apify)\n');

    if (!pool.options.connectionString) {
        console.error('❌ DATABASE_URL not set. Run with: DATABASE_URL="your-url" node enrich_company_profiles_free.js');
        process.exit(1);
    }

    try {
        // Get companies that haven't been enriched yet (no profile_enriched_at)
        const result = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                id, company_name, 
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'company_profile' as current_profile,
                custom_data->>'profile_enriched_at' as enriched_at,
                custom_data as full_custom_data
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            ORDER BY company_name, created_at DESC
        `);

        // Filter to only companies not yet enriched
        const toEnrich = result.rows.filter(r => !r.enriched_at);

        console.log(`📊 Found ${result.rows.length} unique companies`);
        console.log(`📊 Already enriched: ${result.rows.length - toEnrich.length}`);
        console.log(`📊 Need enrichment: ${toEnrich.length}\n`);

        let enriched = 0;
        let skipped = 0;
        let lowFit = 0;

        for (let i = 0; i < toEnrich.length; i++) {
            const company = toEnrich[i];
            console.log(`\n${i + 1}/${toEnrich.length}: ${company.company_name}`);

            // Build website URL
            let siteUrl = company.website || company.domain;
            if (siteUrl && !siteUrl.startsWith('http')) {
                siteUrl = 'https://' + siteUrl;
            }

            if (!siteUrl) {
                console.log('   ❌ No website/domain - skipping');
                skipped++;
                continue;
            }

            console.log(`   🌐 Website: ${siteUrl}`);

            // Scrape the website using simple fetch
            const content = await scrapeWebsite(siteUrl);

            // Generate profile using Gemini
            const profileData = await generateProfile(company.company_name, siteUrl, content);

            if (!profileData) {
                console.log('   ⚠️ Could not generate profile');
                skipped++;
                continue;
            }

            console.log(`   📝 Profile: ${profileData.company_profile.substring(0, 80)}...`);
            console.log(`   ⭐ Fit Score: ${profileData.fit_score}/10 - ${profileData.fit_reason}`);

            // Flag low fit companies
            if (profileData.fit_score < 4) {
                console.log(`   🗑️ LOW FIT - Consider deleting (score: ${profileData.fit_score})`);
                lowFit++;
            }

            // Update the lead with new profile
            const updatedCustomData = {
                ...company.full_custom_data,
                company_profile: profileData.company_profile,
                fit_score: profileData.fit_score,
                fit_reason: profileData.fit_reason,
                profile_enriched_at: new Date().toISOString()
            };

            await pool.query(
                `UPDATE leads SET custom_data = $1 WHERE company_name = $2`,
                [updatedCustomData, company.company_name]
            );

            console.log('   ✅ Updated in database');
            enriched++;

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 500));
        }

        console.log(`\n\n📊 SUMMARY:`);
        console.log(`   ✅ Enriched: ${enriched} companies`);
        console.log(`   ⏭️ Skipped (no website): ${skipped} companies`);
        console.log(`   🗑️ Low fit (consider deleting): ${lowFit} companies`);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
