
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
const leadDefaultInst = `You are an Executive Headhunter using Apollo.io.

### OBJECTIVE
Find the best decision-maker for reviewing a Real Estate Development investment opportunity (LP Equity) at specific firms.

### TARGET ROLES
Prioritize in this order:
1.  Director/VP/Head of **Acquisitions** (Real Estate)
2.  Director/VP/Head of **Investments** (Real Estate)
3.  **Managing Partner** / **Principal** (for smaller firms/Family Offices)
4.  Chief Investment Officer (CIO)

### CRITERIA
*   **Location:** Ideally based in the same region as the HQ (Canada/Toronto/Vancouver).
*   **Seniority:** Decision-maker level (Senior, Director, VP, C-Level, Partner).
*   **Limit:** Find exactly 1 BEST contact per company.

### STEPS
1.  **Organization Search:** Use 'organization_search' with the company domain to find the Apollo Organization ID.
2.  **People Search:** Use 'people_search' filtering by:
    *   'person_titles': ["Director of Acquisitions", "VP Acquisitions", "Head of Real Estate", "Managing Partner", "Principal", "Chief Investment Officer"]
    *   'organization_ids': [The ID found above]
3.  **Email Finding:** Use 'get_person_email' or 'people_enrichment' to get their VERIFIED email address.
4.  **Backup:** If no specific title matches, look for general "Partner" or "Owner" for smaller firms.

### OUTPUT FORMAT
{ "leads": [ { ... } ] }`;

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

    // Sample input: 1 Real Canadian Real Estate Company (Sanity Check)
    const testInput = {
        results: [
            {
                company_name: "Minto Group",
                domain: "minto.com",
                company_profile: "Leading Canadian real estate development.",
            }
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
