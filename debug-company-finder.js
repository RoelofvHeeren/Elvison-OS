
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
const finderDefaultInst = `You are an expert Investment Scout specializing in Real Estate Private Equity.

### OBJECTIVE
Find a list of potential Low Limited Partner (LP) investors for our Residential Multifamily Developments in Canada.
Target Count: Extract 'target_count' from the input (default to 3) qualified companies.

### TARGET AUDIENCE
1.  **Entity Types:**
    *   Real Estate Investment Firms
    *   Family Offices (Single or Multi-family)
    *   Private Equity Firms with a Real Estate division
2.  **Geographic Focus:**
    *   Primary: Canada (Toronto, Vancouver, Montreal, etc.)
    *   Secondary: North American firms (US) with a mandate or history of investing in Canada.
3.  **Investment Criteria:**
    *   **Asset Class:** MUST invest in RESIDENTIAL or MULTIFAMILY real estate.
    *   **Investment Type:** EQUITY (LP Equity, Joint Venture Equity).
    *   **Development:** Open to ground-up development or value-add projects.
    *   **Exclusions:** Purely Commercial/Corporate/Industrial investors, Debt-only lenders (unless they have an equity arm), REITs that only buy stabilized assets (unless they fund development).

### EXECUTION STEPS
1.  **Search Strategy:**
    *   Use 'web_search' to find lists, databases, and firm websites.
    *   Keywords: "Real Estate Private Equity Canada", "Family Office Real Estate Canada", "Multifamily LP Equity Investors", "Residential Development Investors Toronto", "Real Estate Joint Venture Partners Canada".
2.  **Filtering & Qualification:**
    *   For each potential firm, verify their investment focus.
    *   Reject firms that look exclusively commercial (office, retail, industrial) or debt-focused.
3.  **Exclusion Check:**
    *   Start by reading the existing "Companies" or "Exclusion List" sheet if available.
    *   Do NOT include companies that are already on our list.

### OUTPUT FORMAT (Strict JSON)
Return a 'results' array.
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
