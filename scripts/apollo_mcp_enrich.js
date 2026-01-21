
import fs from 'fs';
import { Agent, Runner, hostedMcpTool } from "@openai/agents";
import { z } from "zod";
import dotenv from 'dotenv';
import { enrichContact } from '../src/backend/services/contact-enrichment-service.js';

dotenv.config();

// 1. Apollo MCP Configuration
const apolloMcp = hostedMcpTool({
    serverLabel: "Apollo_MCP",
    allowedTools: [
        "people_enrichment", "get_person_email", "people_search"
    ],
    authorization: "apollo-mcp-client-key-01",
    requireApproval: "never",
    serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01"
});

// 2. Schema for Lead Output
const ApolloEnrichmentSchema = z.object({
    results: z.array(z.object({
        email: z.string().nullable(),
        linkedin_url: z.string().nullable(),
        first_name: z.string().nullable(),
        last_name: z.string().nullable(),
        title: z.string().nullable(),
        company_name: z.string().nullable()
    }))
});

// 3. Agent Definition
const apolloEnricher = new Agent({
    name: "Apollo Enricher",
    instructions: `You are the Apollo Enrichment specialist.
    
    GOAL: Enrich a specific person using their LinkedIn URL, Name, City, and any available Company data.
    
    STRATEGY:
    1. If a LinkedIn URL is provided, try 'get_person_email' or 'people_enrichment' for that URL.
    2. If no email is found, or no LinkedIn URL is provided, use 'people_search'.
    3. When using 'people_search', use the person's name and refine by location (city/state).
    4. If the input mentions a potential company or organization, use it to narrow down results.
    
    CONSTRAINTS:
    - FOCUS ONLY ON EMAILS.
    - DO NOT REQUEST OR RETURN PHONE NUMBERS.
    
    OUTPUT:
    Return a JSON object with a 'results' array containing exactly one entry if successful.`,
    model: "gpt-4o",
    tools: [apolloMcp],
    outputType: ApolloEnrichmentSchema
});

const runner = new Runner();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runEnrichment() {
    console.log("🚀 STARTING APOLLO MCP ENRICHMENT (Max 200 Credits)\n");

    const candidates = JSON.parse(fs.readFileSync('candidate_owners.json'));
    console.log(`Loaded ${candidates.length} candidates.`);

    let enrichedLeads = [];
    if (fs.existsSync('generated_b2c_leads.json')) {
        try {
            enrichedLeads = JSON.parse(fs.readFileSync('generated_b2c_leads.json'));
            console.log(`Resuming with ${enrichedLeads.length} existing lead records.`);
        } catch (e) {
            console.log("Starting fresh leads file.");
        }
    }

    const processedNames = new Set(enrichedLeads.map(l => l.name));
    let apolloCredits = 0;

    for (let i = 0; i < candidates.length; i++) {
        const owner = candidates[i];
        if (processedNames.has(owner.name)) continue;
        if (apolloCredits >= 200) {
            console.log("\n🛑 APOLLO CREDIT LIMIT REACHED (200). Stopping.");
            break;
        }

        console.log(`\n[${i + 1}/${candidates.length}] 🔍 Processing: ${owner.name} (${owner.city}, ${owner.state})`);

        let finalLead = {
            ...owner,
            status: 'failed',
            enriched_at: new Date().toISOString()
        };

        try {
            // STEP 1: Find LinkedIn & Email via Google (Apify)
            console.log(`   Searching Google for LinkedIn and Email...`);
            const googleResults = await enrichContact(owner.name, `${owner.city} Real Estate`, null);
            const linkedinUrl = googleResults.linkedin;
            const googleEmail = googleResults.email;

            if (linkedinUrl) console.log(`   ✅ Found LinkedIn: ${linkedinUrl}`);
            if (googleEmail) console.log(`   📧 Found Email via Google: ${googleEmail}`);

            let apolloEmail = null;
            let finalLinkedIn = linkedinUrl;
            let finalTitle = null;
            let finalCompany = null;
            let enriched = null;

            // STEP 2: Enrich via Apollo MCP
            console.log(`   Calling Apollo MCP...`);
            const input = {
                name: owner.name,
                location: `${owner.city}, ${owner.state}`,
                linkedin: linkedinUrl,
                context: googleResults.searchResults?.slice(0, 3).map(r => r.snippet).join(' ')
            };

            const result = await runner.run(apolloEnricher, [
                { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }
            ]);

            enriched = result.finalOutput?.results?.[0];

            if (enriched && enriched.email) {
                console.log(`   🎉 Apollo SUCCESS: ${enriched.email}`);
                apolloEmail = enriched.email;
                finalLinkedIn = enriched.linkedin_url || finalLinkedIn;
                finalTitle = enriched.title;
                finalCompany = enriched.company_name;
            } else {
                console.log(`   ⚠️ No email found on Apollo.`);
            }

            // Merge Results
            const bestEmail = apolloEmail || googleEmail;

            if (bestEmail) {
                console.log(`   ✨ FINAL WIN: ${bestEmail}`);
                if (apolloEmail) apolloCredits++; // Count Apollo usage

                finalLead = {
                    ...owner,
                    status: 'enriched',
                    firstName: enriched?.first_name || owner.name.split(' ')[0],
                    lastName: enriched?.last_name || owner.name.split(' ').slice(1).join(' '),
                    email: bestEmail,
                    linkedin: finalLinkedIn,
                    title: finalTitle || (googleEmail ? "Property Owner / Real Estate Agent" : null),
                    company: finalCompany || (googleEmail ? "Self-Employed" : null),
                    enriched_at: new Date().toISOString(),
                    method: apolloEmail ? 'ApolloMatch' : 'GoogleMatch'
                };
            } else {
                console.log(`   ❌ No email found anywhere.`);
            }

        } catch (error) {
            console.error(`   ❌ Error: ${error.message}`);
        }

        // Always save the attempt (even if failed) to generated_b2c_leads.json
        enrichedLeads.push(finalLead);
        processedNames.add(owner.name);
        fs.writeFileSync('generated_b2c_leads.json', JSON.stringify(enrichedLeads, null, 2));

        // Delay to avoid rate limits
        await delay(2000);
    }

    console.log(`\n✨ ENRICHMENT COMPLETE. Total Leads: ${enrichedLeads.length} | Apollo Credits Used: ${apolloCredits}`);
}

runEnrichment();
