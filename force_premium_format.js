/**
 * FORCE PREMIUM FORMAT SCRIPT
 * 
 * Takes companies that have profiles but NO sectional headers and restructures them
 * using Gemini to ensure they hit the premium sectional UI.
 */

import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from './db/index.js';

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

async function main() {
    console.log('💎 Forcing Premium Formatting on Profiles...\n');

    // 1. Find all active companies with a profile but NO '#' headers
    const { rows: targets } = await query(`
        SELECT company_name, (custom_data->>'company_profile') as profile
        FROM leads
        WHERE status != 'DISQUALIFIED'
        AND (custom_data->>'company_profile') IS NOT NULL
        AND (custom_data->>'company_profile') NOT LIKE '%# %'
        GROUP BY company_name, custom_data->>'company_profile'
    `);

    console.log(`Found ${targets.length} companies needing formatting.`);

    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    for (const target of targets) {
        console.log(`Restructuring ${target.company_name}...`);

        const prompt = `
        Restructure this company profile into a professional Intelligence Report with the following EXACT Markdown headers. 
        Do not change the factual content, just reformat it into these sections:
        
        # Summary
        # Investment Strategy
        # Scale & Geographic Focus
        # Portfolio Observations
        # Key Highlights (Use bullet points here)
        
        CONTENT TO RESTRUCTURE:
        ${target.profile}
        `;

        try {
            const result = await model.generateContent(prompt);
            const markdown = result.response.text();

            if (markdown.includes('# Summary')) {
                await query(`
                    UPDATE leads 
                    SET custom_data = jsonb_set(custom_data, '{company_profile}', $1::jsonb), updated_at = NOW()
                    WHERE company_name = $2 AND status != 'DISQUALIFIED'
                `, [JSON.stringify(markdown), target.company_name]);
                console.log(`✅ Formatted ${target.company_name}`);
            }
        } catch (e) {
            console.error(`❌ Failed ${target.company_name}: ${e.message}`);
        }
    }

    console.log('\n✨ Formatting complete.');
    process.exit();
}

main();
