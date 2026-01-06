/**
 * REPAIR PROFILES SCRIPT
 * 
 * Manually targets companies missing profiles and generates them using Gemini.
 */

import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from './db/index.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

const TARGETS = [
    { name: 'Alpine Start Development', url: 'https://alpinestartdev.com' },
    { name: 'Triovest', url: 'https://triovest.com' },
    { name: 'Pivot Real Estate Group', url: 'https://pivotre.com' }
];

const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

async function scrape(url) {
    try {
        const res = await axios.get(url, { timeout: 10000 });
        const $ = cheerio.load(res.data);
        $('script, style, nav, footer').remove();
        return $('body').text().substring(0, 10000).replace(/\s+/g, ' ');
    } catch (e) {
        console.error(`Failed to scrape ${url}:`, e.message);
        return "";
    }
}

async function main() {
    console.log('🛠️ Repairing Missing Profiles...\n');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    for (const target of TARGETS) {
        console.log(`Processing ${target.name}...`);

        const content = await scrape(target.url);

        const prompt = `
        Analyze the following content from ${target.name}'s website and create a professional Intelligence Report.
        
        CONTENT:
        ${content}
        
        REPORT STRUCTURE:
        Use ONLY these Markdown headers:
        # Summary
        # Investment Strategy
        # Scale & Geographic Focus
        # Portfolio Observations
        # Key Highlights (Use bullet points here)
        
        Assign a fit_score (0-10) based on being a Real Estate / Institutional Investor.
        
        Output JSON:
        {"profile": "Markdown content here", "score": 9}
        `;

        try {
            const result = await model.generateContent(prompt);
            const response = result.response.text();
            const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);

            const customDataUpdate = {
                company_profile: parsed.profile,
                fit_score: parsed.score
            };

            await query(`
                UPDATE leads 
                SET custom_data = custom_data || $1::jsonb, updated_at = NOW()
                WHERE company_name ILIKE $2 AND status != 'DISQUALIFIED'
            `, [JSON.stringify(customDataUpdate), `%${target.name}%`]);

            console.log(`✅ Repaired profile & score for ${target.name}`);

        } catch (e) {
            console.error(`❌ Failed to repair ${target.name}:`, e.message);
        }
    }

    process.exit();
}

main();
