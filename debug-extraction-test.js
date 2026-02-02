
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { GeminiModel } from './src/backend/services/gemini.js';

// Load env
const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const MOCK_PROFILE = `
# Summary
Related Companies is a privately owned real estate firm focused on large-scale mixed-use developments. They are involved in development, acquisitions, management and financing of real estate projects primarily in the United States. They do not appear to be an SFO or MFO, but rather a large private investment firm.

# Investment Strategy
Related Companies focuses on developing and acquiring large-scale, mixed-use projects, affordable housing, and increasingly, digital infrastructure. Their activities span from initial development and construction to long-term management and ownership. They operate through joint ventures and partnerships, actively engaging with local communities and seeking to incorporate public spaces and cultural amenities into their projects. They have a focus on affordable housing and community development.

# Entity Classification
Related Companies is classified as a FAMILY_OFFICE_CAPITAL_VEHICLE, given its investment in real estate and infrastructure projects. While they aren't a traditional family office managing wealth, they function as a principal investor, deploying capital directly into real estate development and related ventures, similar to a large family office with a dedicated investment arm. This is supported by their active role in development, acquisitions, and joint ventures.

# Key Highlights
- Active in large-scale mixed-use developments and affordable housing.
- Recent expansion into digital infrastructure with the Saline data center project.
- Geographic focus primarily in the United States, with some international projects (e.g., Brent Cross Town in London, through Related Argent).
- Operates through joint ventures such as Queens Development Group with Sterling Equities.
- Demonstrates a commitment to community engagement and public space integration in developments.
`;

async function testExtraction() {
    console.log("Testing Fact Extraction on Related Companies profile...");

    try {
        const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        const gemini = new GeminiModel(apiKey);

        const prompt = `
        You are an expert at finding specific, verifiable facts about companies for cold outreach.
        
        Analyze the following Company Profile and extract ONE specific "Research Fact" that would be good for breaking the ice in a cold email.
        
        Company Profile:
        ${MOCK_PROFILE}
        
        The fact must be:
        1. Specific (mention a project name, a recent deal, a partnership, or a specific location).
        2. Neutral or Complimentary (e.g. "Recently expanded into digital infrastructure with the Saline data center project").
        3. NOT generic (Do not say "focused on real estate" or "active in development").
        
        Also generate a "Connection Request" message (max 300 chars) and an "Email Message" (max 100 words) using this fact.
        
        Output JSON:
        {
            "research_fact": "...",
            "connection_request": "...",
            "email_message": "..."
        }
        `;

        const response = await gemini.getResponse({
            input: prompt,
            tools: [] // No tools needed, just generation
        });

        // The response format from getResponse has .output array
        const textOutput = response.output.find(o => o.role === 'assistant')?.content?.[0]?.text;

        // Parse JSON
        let json = {};
        try {
            // Strip markdown code blocks if present
            const cleanText = textOutput.replace(/```json/g, '').replace(/```/g, '').trim();
            json = JSON.parse(cleanText);
        } catch (e) {
            console.error("Failed to parse JSON response:", textOutput);
        }

        console.log("Extraction Result:", JSON.stringify(json, null, 2));

    } catch (e) {
        console.error("Extraction Failed:", e);
    }
}

testExtraction();
