/**
 * MASS REPAIR & ENRICHMENT SCRIPT
 * 
 * 1. Targets companies with BAD or MISSING profiles for re-profiling.
 * 2. Targets ALL active companies for lead enrichment using specific high-level titles.
 */

import dotenv from 'dotenv';
dotenv.config();
import { GoogleGenerativeAI } from '@google/generative-ai';
import { query } from './db/index.js';
import { LeadScraperService } from './src/backend/services/lead-scraper-service.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

const REPAIR_PROFILE_TARGETS = [
    { name: 'TMX Group', domain: 'tmx.com' },
    { name: 'Artis REIT', domain: 'artisreit.com' },
    { name: 'Pivot Real Estate Group', domain: 'pivotre.com' }
];

// Titles requested by user
const REQUESTED_TITLES = [
    "CEO", "Founder", "Co-Founder", "Owner", "Principal",
    "Founding Partner", "Managing Partner", "Partner",
    "Director of Investments", "Director of Developments",
    "Vice President", "President", "CIO", "COO"
];

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

async function scrape(url) {
    if (!url) return "";
    try {
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;
        const res = await axios.get(targetUrl, { timeout: 10000 });
        const $ = cheerio.load(res.data);
        $('script, style, nav, footer').remove();
        return $('body').text().substring(0, 15000).replace(/\s+/g, ' ');
    } catch (e) {
        return "";
    }
}

async function repairProfiles() {
    console.log('--- REPAIRING PROFILES ---');
    const genAI = new GoogleGenerativeAI(API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    for (const target of REPAIR_PROFILE_TARGETS) {
        console.log(`Profiling ${target.name}...`);
        const content = await scrape(target.domain);

        const prompt = `
        Analyze the following content from ${target.name}'s website and create a professional Intelligence Report.
        
        CONTENT:
        ${content || "No detailed content found. Use general knowledge about this firm."}
        
        REPORT STRUCTURE:
        Use EXACTLY these Markdown headers:
        # Summary
        # Investment Strategy
        # Scale & Geographic Focus
        # Portfolio Observations
        # Key Highlights (Use bullet points here)
        
        Assign a fit_score (0-10) based on being a Real Estate / Institutional / Private Equity Investor.
        
        Output JSON:
        {"profile": "Markdown content here", "score": 8}
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
                WHERE (company_name ILIKE $2 OR custom_data->>'company_domain' ILIKE $3)
                AND status != 'DISQUALIFIED'
            `, [JSON.stringify(customDataUpdate), `%${target.name}%`, `%${target.domain}%`]);

            console.log(`✅ Repaired profile for ${target.name}`);
        } catch (e) {
            console.error(`❌ Failed ${target.name}: ${e.message}`);
        }
    }
}

async function enrichLeads() {
    console.log('\n--- ENRICHING LEADS ---');

    // 1. Get all active companies from DB
    const { rows: companies } = await query(`
        SELECT DISTINCT company_name, custom_data->>'company_website' as website, custom_data->>'company_domain' as domain
        FROM leads
        WHERE status != 'DISQUALIFIED'
    `);

    console.log(`Found ${companies.length} companies to enrich.`);

    const scraper = new LeadScraperService();
    const filters = {
        job_titles: REQUESTED_TITLES,
        seniority: ["c_suite", "executive", "owner", "partner", "vp", "director"],
        maxResults: 10 // Get more leads per company
    };

    // Process in batches of 10 for Apify
    for (let i = 0; i < companies.length; i += 10) {
        const batch = companies.slice(i, i + 10).map(c => ({
            company_name: c.company_name,
            website: c.website || c.domain,
            domain: c.domain || c.website
        }));

        console.log(`\nBatch ${i / 10 + 1}: Searching for leads in: ${batch.map(c => c.company_name).join(', ')}`);

        try {
            const { leads } = await scraper.fetchLeads(batch, filters);
            console.log(`Found ${leads.length} new leads for this batch.`);

            for (const lead of leads) {
                // Find existing company data to preserve profile/score
                const { rows: existing } = await query(
                    "SELECT custom_data FROM leads WHERE (company_name ILIKE $1 OR custom_data->>'company_domain' ILIKE $2) LIMIT 1",
                    [lead.company_name, lead.company_domain]
                );

                const baseCustomData = existing[0]?.custom_data || {};
                const newCustomData = {
                    ...baseCustomData,
                    ...lead
                };

                // Check if lead already exists by email
                const { rows: leadExists } = await query("SELECT id FROM leads WHERE email = $1", [lead.email]);

                if (leadExists.length === 0 && lead.email) {
                    await query(`
                        INSERT INTO leads (person_name, company_name, job_title, email, linkedin_url, status, custom_data, user_id)
                        VALUES ($1, $2, $3, $4, $5, 'RECOVERED', $6, '00000000-0000-0000-0000-000000000000')
                    `, [`${lead.first_name} ${lead.last_name}`, lead.company_name, lead.title, lead.email, lead.linkedin_url, JSON.stringify(newCustomData)]);
                }
            }
        } catch (e) {
            console.error(`Error in batch ${i / 10 + 1}:`, e.message);
        }
    }
}

async function main() {
    await repairProfiles();
    await enrichLeads();
    console.log('\n✨ All tasks completed.');
    process.exit();
}

main();
