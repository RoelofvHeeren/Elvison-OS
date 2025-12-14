
import { Agent, Runner, hostedMcpTool } from "@openai/agents";
import { z } from "zod";
import dotenv from 'dotenv';
dotenv.config();

// Schema
const ApolloLeadFinderSchema = z.object({
    leads: z.array(z.object({
        date_added: z.string().optional(),
        first_name: z.string(),
        last_name: z.string(),
        company_name: z.string(),
        title: z.string(),
        email: z.string(),
        linkedin_url: z.string().optional(),
        company_website: z.string().optional(),
        company_profile: z.string().optional()
    }))
});

// Tool Definition (Exact copy from workflow.js)
const apolloMcp = hostedMcpTool({
    serverLabel: "Apollo_MCP",
    allowedTools: [
        "people_enrichment", "bulk_people_enrichment", "organization_enrichment",
        "people_search", "organization_search", "organization_job_postings",
        "get_person_email", "employees_of_company"
    ],
    authorization: "apollo-mcp-client-key-01",
    requireApproval: "never",
    serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01"
});

// Agent Instructions (Exact copy)
const leadDefaultInst = `You are the Apollo Headhunter Agent.
Goal: Find decision-makers for Real Estate Investment deals.

### TARGET ROLES
- Priority 1: "Partner", "Principal", "Managing Director", "President", "Head of Real Estate", "Head of Acquisitions".
- Priority 2: "Director of Acquisitions", "Investment Manager", "Vice President Development".
- Exclude: "Analyst", "Associate", "HR", "Legal", "Intern".

### LOCATION
- Priority: Canada (Toronto, Vancouver, Montreal, Calgary).
- Secondary: USA (New York, Chicago, etc.) IF the firm is US-based.

### EXECUTION STEPS
1.  **Bulk Search:** Use 'people_search' ONCE for all assigned companies.
    *   'q_organization_domains_list': [List of domains from input]
    *   'person_titles': ["Director of Acquisitions", "VP Acquisitions", "Head of Real Estate", "Managing Partner", "Principal", "Chief Investment Officer"]
2.  **Match & Select:**
    *   From the search results, match them back to the input companies.
    *   Select the ONE best lead per company.
3.  **Email Finding:** Use 'get_person_email' or 'people_enrichment' to get verified emails for selected leads.

### OUTPUT FORMAT (JSON)
{
  "leads": [
    {
      "first_name": "...",
      "last_name": "...",
      "title": "...",
      "email": "...",
      "linkedin_url": "...",
      "company_name": "...",
      "company_profile": "(Pass through from input)"
    }
  ]
}`;

// Agent Definition
const apolloLeadFinder = new Agent({
    name: "Apollo Lead Finder",
    instructions: leadDefaultInst,
    model: "gpt-5-mini", // Using the same model as production
    tools: [apolloMcp],
    outputType: ApolloLeadFinderSchema,
});

async function runDebug() {
    console.log("Starting Apollo Debug (Bulk Mode)...");

    // Sample input: 1 Real Company (Testing bulk arg with single item)
    const testInput = {
        results: [
            { company_name: "QuadReal", domain: "quadreal.com", company_profile: "Global real estate investment." }
        ]
    };

    const runner = new Runner();

    try {
        console.log("Running agent with input:", JSON.stringify(testInput, null, 2));
        const result = await runner.run(apolloLeadFinder, [
            { role: "user", content: [{ type: "input_text", text: JSON.stringify(testInput) }] }
        ]);

        console.log("\n--- RESULT ---");
        console.log(JSON.stringify(result.finalOutput, null, 2));
    } catch (error) {
        console.error("Debug failed:", error);
    }
}

runDebug();
