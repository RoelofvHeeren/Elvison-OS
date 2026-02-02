
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { GeminiModel } from './src/backend/services/gemini.js';

// Load env
const { Client } = pg;

const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const client = new Client({
    connectionString: envConfig.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function extractFactAndMessage(profile, gemini) {
    if (!profile || profile.length < 50) return null;

    const prompt = `
    Analyze the following Company Profile and extract ONE specific "Research Fact" for cold outreach.
    
    Company Profile:
    ${profile.substring(0, 3000)}
    
    Output JSON:
    {
        "research_fact": "...",
        "connection_request": "...",
        "email_message": "..."
    }
    `;

    try {
        const response = await gemini.getResponse({ input: prompt, tools: [] });
        const textToken = response.output.find(o => o.role === 'assistant')?.content?.[0]?.text;
        const cleanJson = textToken.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
    } catch (e) {
        console.error("Extraction error:", e.message);
        return null;
    }
}

async function fixData() {
    try {
        await client.connect();
        const gemini = new GeminiModel(process.env.GOOGLE_API_KEY || envConfig.GOOGLE_API_KEY);

        // 1. Find leads with empty root profile but present custom_data profile
        const res = await client.query(`
            SELECT id, custom_data 
            FROM leads 
            WHERE (company_profile IS NULL OR LENGTH(company_profile) < 10)
            AND custom_data->>'company_profile' IS NOT NULL
            AND LENGTH(custom_data->>'company_profile') > 50
        `);

        console.log(`Found ${res.rows.length} leads to fix.`);

        for (const lead of res.rows) {
            const profile = lead.custom_data.company_profile;
            console.log(`Fixing Lead ${lead.id}...`);

            // Generate Fact & Message
            const extraction = await extractFactAndMessage(profile, gemini);

            if (extraction) {
                await client.query(`
                    UPDATE leads 
                    SET 
                        company_profile = $1,
                        research_fact = $2,
                        connection_request = $3,
                        email_message = $4,
                        outreach_status = 'pending'
                    WHERE id = $5
                `, [
                    profile,
                    extraction.research_fact,
                    extraction.connection_request,
                    extraction.email_message,
                    lead.id
                ]);
                console.log(` -> Updated with Fact: "${extraction.research_fact.substring(0, 30)}..."`);
            } else {
                // Just copy profile if extraction failed
                await client.query(`
                    UPDATE leads SET company_profile = $1 WHERE id = $2
                `, [profile, lead.id]);
                console.log(` -> Copied profile only (Extraction failed)`);
            }
        }

    } catch (err) {
        console.error("Fix error:", err);
    } finally {
        await client.end();
    }
}

fixData();
