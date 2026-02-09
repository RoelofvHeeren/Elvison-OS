/**
 * Company Profile Enrichment Script
 * 
 * This script goes through all leads, visits their company websites,
 * and generates detailed profiles including deal history and investment focus.
 * 
 * Usage: DATABASE_URL="your-neon-url" node enrich_company_profiles.js
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

// Apify for website scraping
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

async function scrapeWebsite(url) {
    try {
        console.log(`   📡 Scraping: ${url}`);

        // Use Apify web scraper
        const response = await fetch('https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items?token=' + APIFY_TOKEN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                startUrls: [{ url }],
                maxCrawlPages: 5,
                maxConcurrency: 3
            })
        });

        const data = await response.json();
        if (data && data.length > 0) {
            return data.map(d => d.text || d.markdown || '').join('\n').substring(0, 15000);
        }
        return null;
    } catch (e) {
        console.log(`   ⚠️ Scrape failed: ${e.message}`);
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
1. What the company does (core business, niche) - HIGHLIGHT RESIDENTIAL FOCUS
2. Size/Scale (AUM, employees, projects, founded date)
3. Geographic focus
4. Investment focus areas / key services (Mention Multifamily, Single Family, etc.)
5. PORTFOLIO HIGHLIGHTS (CRITICAL):
   - List SPECIFIC names of past residential projects, acquisitions, or developments.
   - "Acquired X Apartments in Y City", "Developed Z Community".
   - We need concrete proof of their residential experience.
6. Why they might be a good fit for residential real estate development partnerships

Also rate this company 1-10 for fit as a RESIDENTIAL real estate investment partner:
- 10: Perfect - actively invests in RESIDENTIAL real estate (Multifamily, SFR, BTR)
- 7-9: Strong fit - invests in real estate with some residential component
- 4-6: Potential - general real estate or financial services, unclear residential focus
- 1-3: Poor fit - commercial only (Office/Industrial) or not relevant to real estate

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
    console.log('🚀 Company Profile Enrichment Script\n');

    if (!pool.options.connectionString) {
        console.error('❌ DATABASE_URL not set. Run with: DATABASE_URL="your-url" node enrich_company_profiles.js');
        process.exit(1);
    }

    try {
        // Get all unique companies without detailed profiles
        const result = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                id, company_name, 
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'company_profile' as current_profile,
                custom_data as full_custom_data
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            ORDER BY company_name, created_at DESC
        `);

        console.log(`📊 Found ${result.rows.length} unique companies\n`);

        let enriched = 0;
        let deleted = 0;

        for (const company of result.rows) {
            console.log(`\n${enriched + deleted + 1}/${result.rows.length}: ${company.company_name}`);

            // Build website URL
            let siteUrl = company.website || company.domain;
            if (siteUrl && !siteUrl.startsWith('http')) {
                siteUrl = 'https://' + siteUrl;
            }

            if (!siteUrl) {
                console.log('   ❌ No website/domain - skipping');
                continue;
            }

            console.log(`   🌐 Website: ${siteUrl}`);

            // Scrape the website
            const content = await scrapeWebsite(siteUrl);

            // Generate profile using Gemini
            const profileData = await generateProfile(company.company_name, siteUrl, content);

            if (!profileData) {
                console.log('   ⚠️ Could not generate profile');
                continue;
            }

            console.log(`   📝 Profile: ${profileData.company_profile.substring(0, 100)}...`);
            console.log(`   ⭐ Fit Score: ${profileData.fit_score}/10 - ${profileData.fit_reason}`);

            // Decide whether to keep or suggest deletion
            if (profileData.fit_score < 4) {
                console.log(`   🗑️ LOW FIT - Consider deleting (score: ${profileData.fit_score})`);
                deleted++;
            } else {
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
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`\n\n📊 SUMMARY:`);
        console.log(`   ✅ Enriched: ${enriched} companies`);
        console.log(`   🗑️ Low fit (consider deleting): ${deleted} companies`);

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
