
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { GeminiModel } from './src/backend/services/gemini.js';

const { Client } = pg;
const envPath = path.resolve(process.cwd(), '.env');
const envConfig = dotenv.parse(fs.readFileSync(envPath));

const client = new Client({
    connectionString: envConfig.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const CONCURRENCY = 15;

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
        return null;
    }
}

async function processBatch(leads, gemini) {
    const promises = leads.map(async (lead) => {
        const profile = lead.custom_data.company_profile;
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
            process.stdout.write('.'); // Progress dot
        } else {
            await client.query(`
                UPDATE leads SET company_profile = $1 WHERE id = $2
            `, [profile, lead.id]);
            process.stdout.write('x'); // Failure indication
        }
    });

    await Promise.all(promises);
}

async function fixData() {
    try {
        await client.connect();
        const gemini = new GeminiModel(process.env.GOOGLE_API_KEY || envConfig.GOOGLE_API_KEY);

        // Fetch candidates
        const res = await client.query(`
            SELECT id, custom_data 
            FROM leads 
            WHERE (company_profile IS NULL OR LENGTH(company_profile) < 10)
            AND custom_data->>'company_profile' IS NOT NULL
            AND LENGTH(custom_data->>'company_profile') > 50
        `);

        const total = res.rows.length;
        console.log(`Starting Turbo Fix for ${total} leads...`);

        for (let i = 0; i < total; i += CONCURRENCY) {
            const batch = res.rows.slice(i, i + CONCURRENCY);
            await processBatch(batch, gemini);
            console.log(`\nProcessed ${Math.min(i + CONCURRENCY, total)}/${total}`);
        }

    } catch (err) {
        console.error("Fix error:", err);
    } finally {
        await client.end();
    }
}

fixData();
