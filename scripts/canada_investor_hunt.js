
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
    GOAL: Find the verified email for a Canadian investor using their LinkedIn URL.
    STRATEGY: 
    1. FIRST use 'people_search' with the name and location to find the person's Apollo ID.
    2. THEN use 'get_person_email' with that ID (or the best match) to get the email.
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

                    // 2.2 Enrichment: Two-Step Agent Flow to force tool usage
                    // Step A: Search for the Person ID
                    console.log(`      Running Apollo Search...`);
                    const searchInput = { name: name, q_organization_domains: city + ", Canada" }; // fuzzy search

                    try {
                        let emailFound = null;

                        // Unified Agent with explicit instructions for tool usage
                        console.log(`      Running Apollo Enrichment (gpt-4o-mini)...`);
                        const agent = new Agent({
                            name: "Apollo Worker",
                            instructions: "You are a tool-using assistant. Your ONLY goal is to find the email. \n" +
                                "1. Call 'people_search' with `name` and `q_organization_domains` (set to location) to find the ID.\n" +
                                "2. Call 'get_person_email' with the ID found.\n" +
                                "3. Return the email in JSON format: { \"email\": \"...\" }.",
                            model: "gpt-4o-mini",
                            tools: [apolloMcp]
                        });

                        const result = await runner.run(agent, [
                            { role: "user", content: `Find email for: ${name} (Location: ${city}, Canada)` }
                        ]);

                        // Debug: What tools ran?
                        const toolsUsed = result.steps?.flatMap(s => s.toolCalls?.map(tc => tc.function.name)) || [];
                        if (toolsUsed.length > 0) console.log(`      Tools: ${toolsUsed.join(" -> ")}`);

                        const outputText = JSON.stringify(result.finalOutput);
                        const emailMatch = outputText.match(/[\w.-]+@[\w.-]+\.\w+/);

                        if (emailMatch) {
                            emailFound = emailMatch[0];
                            console.log(`      🎉 SUCCESS: ${emailFound}`);
                        } else {
                            console.log(`      ❌ No email found.`);
                        }

                        if (emailFound) {
                            apolloCredits++;
                            const newLead = {
                                name: name,
                                city: city,
                                email: emailFound,
                                linkedin: linkedinUrl,
                                title: "Real Estate Investor",
                                company: "Self-Employed",
                                snippet: snippet,
                                enriched_at: new Date().toISOString(),
                                source: "LinkedIn_Hunt"
                            };

                            allLeads.push(newLead);
                            processedEvaluations.add(linkedinUrl);
                            fs.writeFileSync('generated_canadian_leads.json', JSON.stringify(allLeads, null, 2));
                        } else {
                            processedEvaluations.add(linkedinUrl);
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
