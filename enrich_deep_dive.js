/**
 * Deep Dive Company Enrichment (Score >= 6)
 * 
 * Generates highly detailed profiles (20+ sentences) for top-tier leads.
 * - Extracts executive team, deal history, investment criteria.
 * - Scores fit strictly.
 * 
 * Usage: DATABASE_URL="your-url" node enrich_deep_dive.js
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Simple fetch scraper (same as before, but reliable)
async function scrapeWebsite(url) {
    try {
        console.log(`   📡 Fetching: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.log(`   ⚠️ HTTP ${response.status}`);
            return null;
        }

        const html = await response.text();
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 25000); // More context
        console.log(`   ✅ Fetched ${text.length} chars`);
        return text;
    } catch (e) {
        console.log(`   ⚠️ Fetch failed: ${e.message}`);
        return null;
    }
}

    async function generateDeepProfile(companyName, domain, content) {
    const prompt = `
    You are a Senior Investment Analyst for a major Real Estate Developer. 
    Write a DEEP DIVE INVESTMENT MEMO for: ${companyName} (${domain}).
    
    WEBSITE CONTENT:
    ${content || "No content available."}
    
    INSTRUCTIONS:
    - Create a HIGHLY DETAILED, PROFESSIONAL profile (20+ sentences).
    - Do NOT be generic. Use specific numbers, names, and locations found in the text.
    - If they are NOT an investor (e.g. brokerage, supplier), explicitly state this and give a low score.
    
    REQUIRED SECTIONS:
    1. **Executive Summary**: Who they are, AUM (Assets Under Management), headquarters, and primary focus.
    2. **Investment Strategy**: What do they buy/build? (Asset classes: Residential, Industrial, Office? Risk profile: Core, Value-Add, Opportunistic?)
    3. **Deal History**: Mention specific projects, properties, or recent transactions found in the text.
    4. **Key People**: List key executives or partners mentioned (CEO, CIO, Heads of Development).
    5. **Fit Analysis**: Why are they a good/bad partner for a residential developer?

    SCORING (Strict Investor Only):
    - 9-10: Large Institutional Investor (Pension, REIT, PE) actively deploying capital in Real Estate.
    - 7-8: Family Office or Private Capital active in RE.
    - 1-4: Brokerage, Tenant, Supplier, Service Provider (NO INVESTMENT CAPITAL).

    OUTPUT JSON:
    {
        "company_profile": "Full markdown-formatted profile string...",
        "fit_score": 8,
        "fit_reason": "Specific reason...",
        "investor_type": "Pension Fund / REIT / Family Office / Not Investor"
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text();
        
        // Cleanup markdown code blocks if present
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();

        // Find JSON object
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.log('   ⚠️ JSON Parse Error. Attempting naive cleanup...');
                // Try to sanitize common JSON breaking chars in description if simple parse fails
                const cleanJson = jsonMatch[0].replace(/[\u0000-\u0019]+/g,"");
                return JSON.parse(cleanJson);
            }
        }
        return null;
    } catch (e) {
        console.log(`   ⚠️ AI Error: ${e.message}`);
        return null; // Don't crash
    }
}

async function main() {
    console.log('🚀 DEEP DIVE Company Enrichment (Score >= 6)\n');

    try {
        // Fetch unique companies with score >= 6
        const result = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                id, company_name, 
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'fit_score' as score,
                custom_data as full_custom_data
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            AND (custom_data->>'fit_score')::int >= 6
            ORDER BY company_name, created_at DESC
        `);

        console.log(`📊 Found ${result.rows.length} high-potential companies to enrich.`);

        for (let i = 0; i < result.rows.length; i++) {
            const company = result.rows[i];
            console.log(`\n${i + 1}/${result.rows.length}: ${company.company_name} (Current: ${company.score}/10)`);

            const url = company.website || (company.domain ? `https://${company.domain}` : null);
            if (!url) {
                console.log('   ❌ No URL - skipping');
                continue;
            }

            const content = await scrapeWebsite(url);
            const deepProfile = await generateDeepProfile(company.company_name, company.domain, content);

            if (deepProfile) {
                console.log(`   📝 Generated Deep Profile (${deepProfile.company_profile.length} chars)`);
                console.log(`   ⭐ Score: ${deepProfile.fit_score}/10 - ${deepProfile.investor_type}`);

                if (deepProfile.fit_score < 6) {
                    console.log('   📉 Downgrading score (found to be non-investor)');
                }

                // Update DB
                const updatedCustomData = {
                    ...company.full_custom_data,
                    company_profile: deepProfile.company_profile,
                    fit_score: deepProfile.fit_score,
                    fit_reason: deepProfile.fit_reason,
                    investor_type: deepProfile.investor_type,
                    deep_dive_at: new Date().toISOString()
                };

                await pool.query(
                    `UPDATE leads SET custom_data = $1 WHERE company_name = $2`,
                    [updatedCustomData, company.company_name]
                );
                console.log('   ✅ Saved Deep Dive Profile');
            } else {
                console.log('   ⚠️ Failed to generate profile');
            }

            await new Promise(r => setTimeout(r, 1000)); // Respect rate limits
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
