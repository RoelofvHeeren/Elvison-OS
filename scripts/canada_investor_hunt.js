
import fs from 'fs';
import { Agent, Runner, hostedMcpTool } from "@openai/agents";
import { z } from "zod";
import dotenv from 'dotenv';
import { performGoogleSearch } from '../src/backend/services/apify.js';

dotenv.config();

// 1. Apollo MCP Configuration
const apolloMcp = hostedMcpTool({
    serverLabel: "Apollo_MCP",
    allowedTools: ["get_person_email", "people_search"],
    authorization: "apollo-mcp-client-key-01",
    requireApproval: "never",
    serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01"
});

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

const apolloEnricher = new Agent({
    name: "Apollo Enricher",
    instructions: `You are the Apollo Enrichment specialist.
    GOAL: Enrich a Canadian investor using their LinkedIn URL.
    CONSTRAINTS: Email only. No phone numbers.
    OUTPUT: Return a JSON object with a 'results' array.`,
    model: "gpt-4o",
    tools: [apolloMcp],
    outputType: ApolloEnrichmentSchema
});

const runner = new Runner();

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 2. The Hunt Logic
async function huntCanadianInvestors() {
    console.log("🍁 STARTING CANADIAN INVESTOR HUNT (Target: 200 Leads)...");

    const CITIES = [
        "Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton"
    ];

    const SEARCH_QUERIES = [
        `site:linkedin.com/in "real estate investor" "Canada" -intitle:jobs`,
        `site:linkedin.com/in "property investor" "Canada" -intitle:recruiter`
    ];

    let allLeads = [];
    if (fs.existsSync('generated_canadian_leads.json')) {
        try {
            allLeads = JSON.parse(fs.readFileSync('generated_canadian_leads.json'));
            console.log(`Loaded ${allLeads.length} existing Canadian leads.`);
        } catch (e) { console.log("Starting fresh."); }
    }

    // Track processed URLs to avoid duplicates
    const processedEvaluations = new Set(allLeads.map(l => l.linkedin));
    let apolloCredits = 0;

    for (const city of CITIES) {
        if (allLeads.length >= 200) break;
        if (apolloCredits >= 150) {
            console.log("🛑 Credit soft limit reached.");
            break;
        }

        console.log(`\n=== 🏙️  Hunting in ${city} ===`);

        for (const queryTemplate of SEARCH_QUERIES) {
            const query = queryTemplate.replace("Canada", city); // Localize the search
            console.log(`   🔎 Searching: ${query}`);

            try {
                // Get more results to filter down
                const searchResults = await performGoogleSearch(query, process.env.APIFY_API_TOKEN);

                if (!searchResults || searchResults.length === 0) {
                    console.log("   ⚠️ No results found.");
                    continue;
                }

                console.log(`   ✅ Found ${searchResults.length} potential profiles.`);

                for (const profile of searchResults) {
                    const linkedinUrl = profile.link;
                    const snippet = profile.snippet || profile.title;
                    const name = profile.title.split(" - ")[0].trim();

                    if (!linkedinUrl || processedEvaluations.has(linkedinUrl)) continue;

                    // 2.1 Basic Filtering (Client-side regex first to save AI tokens)
                    // Loosened filter + fallback to title match
                    const combinedText = (name + " " + snippet).toLowerCase();
                    const isRelevant = /investor|owner|holding|portfolio|estate|buying|properties|deals|equity/i.test(combinedText);
                    if (!isRelevant) {
                        console.log(`   Skipping (Irrelevant): ${name}`);
                        continue;
                    }

                    console.log(`   🎯 Targeting: ${name}`);

                    // 2.2 Enrichment
                    console.log(`      Calling Apollo for Email...`);

                    // Input for Apollo Agent (Provide more context for better matching)
                    const input = {
                        linkedin: linkedinUrl,
                        name: name,
                        location: city + ", Canada"
                    };

                    try {
                        const result = await runner.run(apolloEnricher, [
                            { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }
                        ]);

                        const enriched = result.finalOutput?.results?.[0];

                        if (enriched && enriched.email) {
                            console.log(`      🎉 SUCCESS: ${enriched.email}`);
                            apolloCredits++;

                            const newLead = {
                                name: name,
                                city: city,
                                email: enriched.email,
                                linkedin: linkedinUrl,
                                title: enriched.title || "Real Estate Investor",
                                company: enriched.company_name || "Self-Employed",
                                snippet: snippet,
                                enriched_at: new Date().toISOString(),
                                source: "LinkedIn_Hunt"
                            };

                            allLeads.push(newLead);
                            processedEvaluations.add(linkedinUrl);

                            // Save immediately
                            fs.writeFileSync('generated_canadian_leads.json', JSON.stringify(allLeads, null, 2));
                        } else {
                            console.log(`      ❌ No email found.`);
                            processedEvaluations.add(linkedinUrl); // Don't try again
                        }
                    } catch (agentErr) {
                        console.error(`      Agent Error: ${agentErr.message}`);
                    }

                    await delay(2000); // Be nice to APIs
                }

            } catch (err) {
                console.error(`   ❌ Search Error: ${err.message}`);
            }
        }
    }

    console.log(`\n🍁 HUNT COMPLETE. Total Valid Leads: ${allLeads.length}`);
}

huntCanadianInvestors();
