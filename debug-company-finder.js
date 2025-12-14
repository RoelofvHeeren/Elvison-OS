
import { Agent, Runner, hostedMcpTool, webSearchTool } from "@openai/agents";
import { z } from "zod";
import dotenv from 'dotenv';
dotenv.config();

// Schema (Exact copy)
const CompanyFinderSchema = z.object({
    results: z.array(z.object({
        company_name: z.string(),
        hq_city: z.string(),
        capital_role: z.enum(["LP", "JV", "CoGP", "Mixed"]),
        website: z.string(),
        domain: z.string(),
        why_considered: z.string(),
        source_links: z.array(z.string())
    }))
});

// Sheet MCP (Needed for exclusion list, even if empty for debug)
const sheetMcp = hostedMcpTool({
    serverLabel: "Sheet_MCP",
    allowedTools: ["read_headings", "read_all_from_sheet"], // Minimal tools
    requireApproval: "never",
    serverUrl: "https://final-sheet-mcp-production.up.railway.app/sse"
});

const webSearch = webSearchTool();

// Current Default Instructions (Copy from workflow.js to establish baseline)
// I will start with the one I see in the file, then we will modify it.
const finderDefaultInst = `You are the "Hunter" Agent for Fifth Avenue Properties.
### GOAL
Find exactly "target_count" (default 10) qualified Real Estate Investment Firms in Canada.
**YOU MUST NOT FAIL. YOU MUST NOT RETURN EMPTY.**

### 1. KEYWORD GENERATION (Internal Thought Process)
You will use a "Brute Force" search strategy. You must cycle through these specific search queries until you fill the list:
- "Real estate investment firm Canada residential"
- "Top 100 real estate investment firms Canada"
- "Multi-family family office Toronto real estate"
- "Private equity real estate firms Vancouver residential"
- "Canadian institutional investors multifamily development"
- "Joint venture equity partners Canada real estate"

### EXECUTION LOOP
**DO NOT just do one search and quit.**
Step A: Run Search Query 1.
Step B: Scrape the results. Look for FIRM NAMES and WEBSITES.
Step C: If you found good matches, add them to your list.
Step D: If you still need more companies, Run Search Query 2.
Step E: Repeat until you have [target_count] companies.

### OUTPUT FORMAT (Strict JSON)
Return ONLY the companies you found.
`;

const companyFinder = new Agent({
    name: "Company Finder",
    instructions: finderDefaultInst,
    model: "gpt-5.2",
    tools: [webSearch, sheetMcp],
    outputType: CompanyFinderSchema,
});

async function runDebug() {
    console.log("Starting Company Finder Debug...");
    const runner = new Runner();

    try {
        // Mimic the workflow input
        const prompt = "Find 5 qualified companies. [SYSTEM INJECTION]: You are in iteration 1. Your GOAL is to find exactly 5 NEW companies.";

        console.log("Running agent with prompt:", prompt);
        const result = await runner.run(companyFinder, [
            { role: "user", content: [{ type: "input_text", text: prompt }] }
        ]);

        console.log("\n--- RESULT ---");
        console.log(JSON.stringify(result.finalOutput, null, 2));
    } catch (error) {
        console.error("Debug failed:", error);
    }
}

runDebug();
