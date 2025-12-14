
import { fileSearchTool, hostedMcpTool, webSearchTool, Agent, Runner, withTrace } from "@openai/agents";
import { z } from "zod";

// --- Schema Definitions ---
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

const CompanyProfilerSchema = z.object({
    results: z.array(z.object({
        company_name: z.string(),
        domain: z.string(),
        company_profile: z.string()
    }))
});

const ApolloLeadFinderSchema = z.object({
    leads: z.array(z.object({
        date_added: z.string(),
        first_name: z.string(),
        last_name: z.string(),
        company_name: z.string(),
        title: z.string(),
        email: z.string(),
        linkedin_url: z.string(),
        company_website: z.string(),
        company_profile: z.string()
    }))
});

const OutreachCreatorSchema = z.object({
    leads: z.array(z.object({
        date_added: z.string(),
        first_name: z.string(),
        last_name: z.string(),
        company_name: z.string(),
        title: z.string(),
        email: z.string(),
        linkedin_url: z.string(),
        company_website: z.string(),
        connection_request: z.string(),
        email_message: z.string(),
        company_profile: z.string()
    }))
});

const SheetBuilderSchema = z.object({
    spreadsheet_url: z.string(),
    status: z.string()
});

// --- Dynamic Workflow Function ---
/**
 * Runs the agent workflow with dynamic vector store inputs.
 * @param {Object} input - Workflow input { input_as_text: string }
 * @param {Object} config - Configuration { vectorStoreId: string, sheetId: string, agentConfigs: Object }
 */
export const runAgentWorkflow = async (input, config) => {
    const { vectorStoreId, sheetId, agentConfigs = {} } = config;

    // Helper to get tools for an agent
    const getToolsForAgent = (agentKey) => {
        const agentConfig = agentConfigs[agentKey];
        const configEnabledIds = agentConfig?.enabledToolIds;
        const tools = [];

        // 1. File Search Tool (if files are linked)
        // Note: linkedFileIds are FILE IDs. fileSearchTool expects VECTOR STORE IDs.
        // We cannot pass file IDs directly to vector_store_ids.
        // For now, only use the global vectorStoreId if it is valid.
        if (vectorStoreId && vectorStoreId.startsWith('vs_')) {
            tools.push(fileSearchTool([vectorStoreId]));
        }

        // 2. Determine enabled tool IDs (use config if present, otherwise defaults)
        let enabledIds = [];
        if (configEnabledIds && Array.isArray(configEnabledIds)) {
            enabledIds = configEnabledIds;
        } else {
            // Default tools per agent if no config provided
            switch (agentKey) {
                case 'company_finder':
                    enabledIds = ['web_search', 'sheet_mcp'];
                    break;
                case 'company_profiler':
                    enabledIds = ['web_search'];
                    break;
                case 'apollo_lead_finder':
                    enabledIds = ['apollo_mcp']; // Relies on Apollo
                    break;
                case 'outreach_creator':
                    enabledIds = []; // Relies on vector store (file search)
                    break;
                case 'sheet_builder':
                    enabledIds = ['sheet_mcp'];
                    break;
            }
        }

        // 3. Attach matching tools
        if (enabledIds.includes('sheet_mcp')) {
            tools.push(sheetMcp);
        }
        if (enabledIds.includes('apollo_mcp')) {
            tools.push(apolloMcp);
        }
        if (enabledIds.includes('web_search')) {
            tools.push(webSearch);
        }

        return tools;
    };

    // Helper to get instructions
    const getInstructions = (agentKey, defaultInst) => {
        return agentConfigs[agentKey]?.instructions || defaultInst;
    };

    const listeners = config.listeners || {};
    const logStep = (step, detail) => {
        if (listeners.onLog) {
            listeners.onLog({ step, detail, timestamp: new Date().toISOString() });
        }
    };

    // Standard Tools
    const webSearch = webSearchTool();

    // MCP Tools (Hardcoded URLs from user snippet)
    const sheetMcp = hostedMcpTool({
        serverLabel: "Sheet_MCP",
        allowedTools: [
            "refresh_auth", "create_spreadsheet", "list_sheets", "create_sheet",
            "read_all_from_sheet", "read_headings", "read_rows", "read_columns",
            "edit_cell", "edit_row", "edit_column", "insert_row", "insert_column",
            "rename_sheet", "rename_doc"
        ],
        requireApproval: "never", // Changed to never for automated flow
        serverUrl: "https://final-sheet-mcp-production.up.railway.app/sse"
    });

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

    // --- Agent Definitions ---

    // 1. Company Finder
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

### 2. EXECUTION LOOP
**DO NOT just do one search and quit.**
Step A: Run Search Query 1.
Step B: Scrape the results. Look for FIRM NAMES and WEBSITES.
Step C: If you found good matches, add them to your list.
Step D: If you still need more companies, Run Search Query 2.
Step E: Repeat until you have [target_count] companies.

### 3. WHAT TO LOOK FOR (The "Good Fit")
- **Keywords on Website:** "Residential", "Multifamily", "Development", "LP Equity", "Investment Management", "Asset Management".
- **Must Be:** An Investment Firm, Fund, or Family Office.
- **Must NOT Be:** A Realtor, a Mortgage Broker, or a Service Provider.

### 4. OUTPUT FORMAT (Strict JSON)
Return ONLY the companies you found.
{
  "results": [
    {
      "company_name": "Name",
      "hq_city": "City",
      "capital_role": "LP/Fund/Family Office",
      "website": "URL",
      "domain": "domain.com",
      "why_considered": "Found via [Search Term]. Website mentions residential equity.",
      "source_links": ["url"]
    }
  ]
}`;

    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: getInstructions('company_finder', finderDefaultInst),
        model: "gpt-5.2",
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler
    const profilerDefaultInst = `You are a Senior Investment Analyst. Your goal is to deeply research a specific list of Real Estate Investment firms to prepare for high-level B2B outreach.

### INPUT
A list of companies found by the Scout.

### RESEARCH TASKS
For each company:
1.  **Broad Qualification (Lenient):**
    *   Does the firm invest in Real Estate? (Commercial, Residential, Mixed-Use).
    *   **DEFAULT TO QUALIFIED:** Unless the website explicitly says "We DO NOT do equity" or "We are strictly a lender", assume they are relevant.
    *   **Inclusion:** Include firms that mention "Asset Management", "Capital Partners", "Private Equity", or "Developments".
2.  **Portfolio Analysis:**
    *   Look for any Canadian presence (projects, offices, or text).
    *   Even if they are US-based, if they mention "North America", QUALIFY them.
3.  **Investment Philosophy:**
    *   Note if they mention "Value-add", "Development", or "Partnerships".

### OUTPUT FORMAT
{
  "results": [
    {
      "company_name": "String",
      "domain": "String",
      "company_profile": "A 2-3 sentence summary. Focus on their investment capacity and asset classes.",
      "is_qualified": boolean
    }
  ]
}
**IMPORTANT:** Your goal is to fill the funnel. When in doubt, SET is_qualified = true.`;

    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: getInstructions('company_profiler', profilerDefaultInst),
        model: "gpt-5-mini",
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo Lead Finder
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
1.  **Resolve Organization:**
    - Use 'organization_search' with the company domain to find the Apollo Organization ID.
2.  **Find People (Strategy A):**
    - Use 'employees_of_company' with the Org ID and Priority 1 Job Titles.
3.  **Fallback (Strategy B - CRITICAL):**
    - If Strategy A yields 0 leads, use 'people_search'.
    - Keywords: "Real Estate", "Acquisitions", "Investment".
    - Filter by 'organization_ids' (using the ID found in Step 1).
4.  **Limits:**
    - **Select exactly 1** best lead per company.
    - Prioritize those with "verified_email".
5.  **Enrich:**
    - Use 'get_person_email' to reveal email addresses.

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
    const apolloLeadFinder = new Agent({
        name: "Apollo Lead Finder",
        instructions: getInstructions('apollo_lead_finder', leadDefaultInst),
        model: "gpt-5-mini",
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    // 4. Outreach Creator
    const outreachDefaultInst = `You are a Capital Raising Consultant composing email outreach to potential LP Investors.

### CONTEXT
We are a Real Estate Developer in Canada specializing in Residential Multifamily projects.
We are looking for Limited Partners (LP Equity) to invest in our upcoming developments.

### TASK
For each lead, create:
1.  **LinkedIn Connection Request:** (Max 280 chars). Friendly, professional, mentioning a specific relevance.
2.  **Cold Email Body:** (Short, punchy, high-value).

### OUTREACH GUIDE & BRAND VOICE
*   **Tone:** Professional, peer-to-peer, confident, concise. NOT salesy.
*   **Structure:**
    *   **Hook:** Reference their specific focus (e.g., "Saw [Company] is active in Toronto multifamily...").
    *   **Value Prop:** "We have a strong pipeline of off-market multifamily developments in [City]."
    *   **Ask:** "Open to reviewing a teaser?" or "Brief chat to see if it's a fit?"
*   **Personalization:**
    *   Use the 'company_profile' data.
    *   Reference a recent project if known.
    *   Reference their strategy (e.g., "Given your focus on value-add residential...").

### OUTPUT FORMAT
Return the enriched lead objects in the JSON schema.`;

    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: getInstructions('outreach_creator', outreachDefaultInst),
        model: "gpt-5.2", // Best quality for writing
        tools: getToolsForAgent('outreach_creator'),
        outputType: OutreachCreatorSchema,
    });

    // 5. Sheet Builder
    const sheetBuilderDefaultInst = `You are the CRM Data Manager.

    Target Spreadsheet ID: "${sheetId || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'}"
    Target Sheet Name: "AI Lead Sheet"
    
    ### SCHEMA (Columns)
    Ensure the sheet has these headers in order. If not, create them.
    1.  Date Added
    2.  First Name
    3.  Last Name
    4.  Company Name
    5.  Title
    6.  Email
    7.  LinkedIn URL
    8.  Website
    9.  Connection Request
    10. Email Message
    11. Company Profile (Summary)
    
    ### ACTION
    1.  Read the current headers using 'read_headings'.
    2.  If headers don't match, use 'insert_row' at index 1 to set headers.
    3.  For each lead in the input:
       *   Format the data to match the columns.
       *   Use 'insert_row' (or 'append_row' if available) to add the lead.
    4.  Validation: Ensure no columns are shifted.
    
    ### OUTPUT
    Return the full spreadsheet URL (e.g. https://docs.google.com/spreadsheets/d/${sheetId || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'}/edit) and status "success".`;

    const sheetBuilder = new Agent({
        name: "Sheet Builder",
        instructions: getInstructions('sheet_builder', sheetBuilderDefaultInst),
        model: "gpt-5-mini", // Simple utility task
        tools: getToolsForAgent('sheet_builder'),
        outputType: SheetBuilderSchema,
    });

    // Helper for retry logic
    const retryWithBackoff = async (fn, retries = 3, initialDelay = 5000) => {
        let attempt = 0;
        while (attempt <= retries) {
            try {
                return await fn();
            } catch (error) {
                if (error?.status === 429 || (error?.message && error.message.includes('429'))) {
                    attempt++;
                    if (attempt > retries) throw error;
                    const delay = initialDelay * Math.pow(2, attempt - 1); // Exponential backoff
                    console.warn(`Rate limit hit (429). Retrying in ${delay / 1000}s (Attempt ${attempt}/${retries})...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
    };

    // --- Runner Execution ---

    return await withTrace("Lead Gen OS (In-House)", async () => {
        const runner = new Runner({
            traceMetadata: {
                __trace_source__: "in-house-agent",
            }
        });

        // 0. Parse Target Count
        let targetCount = 10;
        const countMatch = input.input_as_text.match(/\b(\d+)\b/);
        if (countMatch) {
            targetCount = parseInt(countMatch[1], 10);
        }
        logStep('Workflow', `Targeting ${targetCount} qualified companies.`);

        let qualifiedCompanies = [];
        let attempts = 0;
        const MAX_ATTEMPTS = 5;
        const originalPrompt = input.input_as_text;

        let lastRoundFound = 0; // Track previous success to adapt strategy
        const debugLog = { discovery: [], qualification: [], apollo: [] };

        // --- LOOP: Discovery & Profiling ---
        while (qualifiedCompanies.length < targetCount && attempts < MAX_ATTEMPTS) {
            attempts++;
            const needed = targetCount - qualifiedCompanies.length;

            // Only log if this is a re-run or substantial update
            if (attempts > 1) {
                logStep('Workflow', `Round ${attempts}: Need ${needed} more qualified companies (Found ${qualifiedCompanies.length}/${targetCount}).`);
            } else {
                logStep('Company Finder', `Identifying potential companies (Target: ${needed})...`);
            }

            // Construct prompt for this iteration
            let currentPrompt = originalPrompt;
            // Inject strict instruction override for this specific batch
            currentPrompt += `\n\n[SYSTEM INJECTION]: You are in iteration ${attempts}. Your GOAL is to find exactly ${needed} NEW companies.`;
            currentPrompt += `\n\n[CRITICAL]: You MUST verify you have read the 'Companies' sheet (using 'read_all_from_sheet') to exclude any firms we have already contacted. Do not skip this step.`;

            // Smart Retry Logic for 0 results
            if (attempts > 1 && lastRoundFound === 0) {
                currentPrompt += `\n\n[ADAPTATION]: Your previous search yielded 0 results. You MUST use different, broader search terms now. Do NOT repeat the same failed search queries. Try variations of the target industry or location.`;
            }

            if (qualifiedCompanies.length > 0) {
                const excludedNames = qualifiedCompanies.map(c => c.company_name).join(", ");
                currentPrompt += `\n\n[EXCLUSION]: You MUST exclude these companies found in previous steps: ${excludedNames}.`;
            }

            // 1. Company Finder
            const finderInput = [{ role: "user", content: [{ type: "input_text", text: currentPrompt }] }];
            const finderRes = await retryWithBackoff(() => runner.run(companyFinder, finderInput));

            if (!finderRes.finalOutput) {
                logStep('Company Finder', 'Agent failed to return output. Retrying...');
                continue;
            }

            const finderResults = finderRes.finalOutput.results || [];
            lastRoundFound = finderResults.length; // Update for next iteration check
            debugLog.discovery.push({ round: attempts, results: finderResults });

            if (finderResults.length === 0) {
                logStep('Company Finder', 'No new companies found in this search.');
                // If we found nothing new, breaking might be safer than looping infinitely, 
                // but let's give it one more chance if we haven't hit max attempts, 
                // reliant on the agent's creativity or "Creative Discovery" instruction.
                if (attempts >= MAX_ATTEMPTS) break;
                continue;
            }

            logStep('Company Finder', `Found ${finderResults.length} candidates. Profiling...`);

            // 2. Profiler
            // Run Profiler only on the new candidates
            const profilerInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ results: finderResults }) }] }];
            const profilerRes = await retryWithBackoff(() => runner.run(companyProfiler, profilerInput));

            if (!profilerRes.finalOutput) {
                logStep('Company Profiler', 'Agent failed. Skipping this batch.');
                continue;
            }

            const profilerResults = profilerRes.finalOutput.results || [];
            const qualifiedInBatch = [];

            // Filter out empty profiles (rejected)
            for (const company of profilerResults) {
                if (company.company_profile && company.company_name) {
                    // Check local duplicate
                    if (!qualifiedCompanies.some(c => c.company_name === company.company_name)) {
                        qualifiedInBatch.push(company);
                    }
                }
            }
            debugLog.qualification.push({ round: attempts, approved: qualifiedInBatch, rejectedCount: finderResults.length - qualifiedInBatch.length });

            if (qualifiedInBatch.length === 0) {
                logStep('Company Profiler', `None of the ${finderResults.length} candidates passed qualification.`);
            } else {
                logStep('Company Profiler', `Qualified ${qualifiedInBatch.length} companies in this batch.`);
                qualifiedCompanies = [...qualifiedCompanies, ...qualifiedInBatch];
            }
        }

        // --- Post-Loop Checks ---
        if (qualifiedCompanies.length === 0) {
            throw new Error(`Workflow failed: Could not find any qualified companies after ${attempts} attempts.`);
        }

        logStep('Workflow', `Loop complete. Proceeding with ${qualifiedCompanies.length} qualified companies.`);

        // 3. Lead Finder
        logStep('Apollo Lead Finder', 'Finding decision makers (Bulk Mode)...');

        let allLeads = [];
        const BATCH_SIZE = 5; // Reduced from 25 to prevent timeouts

        // Filter for valid domains only
        const companiesWithDomains = qualifiedCompanies.filter(c => c.domain && c.domain.includes('.'));

        for (let i = 0; i < companiesWithDomains.length; i += BATCH_SIZE) {
            const batch = companiesWithDomains.slice(i, i + BATCH_SIZE);
            logStep('Apollo Lead Finder', `Processing bulk batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(companiesWithDomains.length / BATCH_SIZE)} (${batch.length} companies)...`);

            // Just pass the list of companies, the agent instruction now handles the bulk search
            const batchInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ results: batch }) }] }];

            try {
                const leadRes = await retryWithBackoff(() => runner.run(apolloLeadFinder, batchInput));

                if (leadRes.finalOutput && leadRes.finalOutput.leads) {
                    allLeads = [...allLeads, ...leadRes.finalOutput.leads];
                    logStep('Apollo Lead Finder', `Batch complete. Found ${leadRes.finalOutput.leads.length} leads.`);
                } else {
                    logStep('Apollo Lead Finder', 'Batch returned no leads.');
                }
            } catch (err) {
                logStep('Apollo Lead Finder', `Error processing batch: ${err.message}`);
            }
        }

        const leadCount = allLeads.length;
        logStep('Apollo Lead Finder', `Total: Found ${leadCount} enriched leads.`);

        // Construct a composite output for the next step
        const leadOutput = { leads: allLeads };
        debugLog.apollo = allLeads;

        // 4. Outreach Creator
        logStep('Outreach Creator', 'Drafting personalized messages...');
        const outreachInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(leadOutput) }] }];

        const outreachRes = await retryWithBackoff(() => runner.run(outreachCreator, outreachInput));
        if (!outreachRes.finalOutput) throw new Error("Outreach Creator failed");

        const outreachOutput = outreachRes.finalOutput;
        const msgCount = outreachOutput.leads ? outreachOutput.leads.length : 0;
        logStep('Outreach Creator', `Drafted messages for ${msgCount} leads.`);

        // 5. Sheet Builder
        logStep('Sheet Builder', 'Exporting to Google Sheets...');
        const sheetInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(outreachOutput) }] }];

        const sheetRes = await retryWithBackoff(() => runner.run(sheetBuilder, sheetInput));
        if (!sheetRes.finalOutput) throw new Error("Sheet Builder failed");

        logStep('Sheet Builder', 'Export complete.');

        // Return structured result containing sheet URL and the actual lead data for the logbook
        return {
            ...sheetRes.finalOutput,
            leads: outreachOutput.leads,
            debug: debugLog
        };
    });
};
