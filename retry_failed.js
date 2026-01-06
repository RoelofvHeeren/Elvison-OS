/**
 * Retry Failed Deep Dive Enrichments
 * 
 * Targets companies with score >= 6 but NO deep profile (or failed previously).
 * Uses specific "Text Only" prompting to avoid JSON parsing errors on long content.
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

async function scrapeWebsite(url) {
    try {
        console.log(`   📡 Fetching: ${url}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timeout);
        if (!response.ok) return null;
        const html = await response.text();
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 25000);
    } catch (e) {
        return null;
    }
}

async function generateRawProfile(companyName, domain, content) {
    const prompt = `
    You are a Senior Investment Analyst. Write a DEEP DIVE INVESTMENT MEMO for: ${companyName} (${domain}).
    
    WEBSITE CONTENT:
    ${content || "No content available."}
    
    INSTRUCTIONS:
    1. Write a HIGHLY DETAILED, PROFESSIONAL profile (20+ sentences).
    2. Include: Executive Summary, Strategy, Deal History, Key People, Fit Analysis.
    3. STRICTLY NO MARKDOWN FORMATTING (no bold, no italics, no lists - just paragraphs).
    4. Start immediately with the profile text. Do not say "Here is the profile".
    5. At the very end, on a new line, write "FIT_SCORE: X" (where X is 1-10) and "TYPE: InvestorType".

    SCORING:
    - 9-10: Large Institutional Investor (Pension, REIT, PE) active in RE.
    - 7-8: Family Office / Private Capital.
    - 1-4: Non-investor.
    `;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) {
        console.log(`   ⚠️ AI Error: ${e.message}`);
        return null;
    }
}

async function main() {
    console.log('🔧 Retrying Failed Enrichments...\n');

    try {
        // Find companies that fit criteria but likely failed (checked by updated_at or profile length)
        const result = await pool.query(`
            SELECT id, company_name, custom_data
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            AND (custom_data->>'fit_score')::int >= 6
            -- Check if deep dive missing (no 'deep_dive_at' or profile is short/old)
            AND (custom_data->>'deep_dive_at' IS NULL OR LENGTH(COALESCE(custom_data->>'company_profile', '')) < 500)
            ORDER BY company_name
        `);

        console.log(`📊 Found ${result.rows.length} companies to retry.\n`);

        for (let i = 0; i < result.rows.length; i++) {
            const company = result.rows[i];
            const url = company.custom_data.company_website || (company.custom_data.company_domain ? `https://${company.custom_data.company_domain}` : null);

            console.log(`${i + 1}/${result.rows.length}: ${company.company_name}`);

            if (!url) {
                console.log('   ❌ No URL');
                continue;
            }

            const content = await scrapeWebsite(url);
            if (!content) {
                console.log('   ❌ Scrape failed');
                continue;
            }

            const rawText = await generateRawProfile(company.company_name, company.custom_data.company_domain, content);

            if (rawText) {
                // Parse the custom format
                const scoreMatch = rawText.match(/FIT_SCORE:\s*(\d+)/i);
                const typeMatch = rawText.match(/TYPE:\s*(.+)/i);

                const fitScore = scoreMatch ? parseInt(scoreMatch[1]) : company.custom_data.fit_score;
                const investorType = typeMatch ? typeMatch[1].trim() : 'Unknown';
                const cleanProfile = rawText.replace(/FIT_SCORE:.*$/i, '').replace(/TYPE:.*$/i, '').trim();

                console.log(`   📝 Generated Profile (${cleanProfile.length} chars)`);
                console.log(`   ⭐ Score: ${fitScore}/10 - ${investorType}`);

                const updatedCustomData = {
                    ...company.custom_data,
                    company_profile: cleanProfile,
                    fit_score: fitScore,
                    investor_type: investorType,
                    deep_dive_at: new Date().toISOString()
                };

                await pool.query(
                    `UPDATE leads SET custom_data = $1 WHERE id = $2`,
                    [updatedCustomData, company.id]
                );
                console.log('   ✅ Saved');
            } else {
                console.log('   ⚠️ Gen failed');
            }

            await new Promise(r => setTimeout(r, 1000));
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
