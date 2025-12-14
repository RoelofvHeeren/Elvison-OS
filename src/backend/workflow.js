
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
{
  "results": [
    {
      "company_name": "Name of the firm",
      "hq_city": "City, Country",
      "capital_role": "LP" | "JV" | "CoGP" | "Mixed",
      "website": "URL",
      "domain": "root domain (e.g., firm.com)",
      "why_considered": "Specific reason why they fit (e.g., 'Website mentions multifamily development equity in Canada').",
      "source_links": ["url1", "url2"]
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
1.  **Verify Investment Strategy:**
    *   Confirm they invest in Residential/Multifamily.
    *   Confirm they do Equity/LP deals (not just lending).
    *   **CRITICAL:** If they DO NOT fit the criteria (e.g., they only do industrial, or only debt), mark them as REJECTED in the profile.
2.  **Portfolio Analysis:**
    *   Look for recent projects or case studies in Canada.
    *   Note specific project names or locations to mention in outreach.
3.  **Investment Philosophy:**
    *   What are they looking for? (e.g., "Value-add", "Ground-up development", "Long-term hold").
4.  **Key People/Decision Makers (Hints):**
    *   Look for "Team" or "People" pages.
    *   Identify titles like: "Director of Acquisitions", "Head of Real Estate", "Chief Investment Officer", "Managing Partner".
    *   Note their names if visible on the site.

### OUTPUT FORMAT
{
  "results": [
    {
      "company_name": "String",
      "domain": "String",
      "company_profile": "A detailed 3-5 sentence summary. \\n\\n- Strategy: [Summary]\\n- Recent Projects: [Examples]\\n- Fit Verification: [CONFIRMED/REJECTED] because...",
      "is_qualified": boolean
    }
  ]
}`;

    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: getInstructions('company_profiler', profilerDefaultInst),
        model: "gpt-5-mini",
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo Lead Finder
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
1.  **Bulk Search:** Use 'people_search' ONCE for all assigned companies.
    *   'q_organization_domains_list': [List of domains from input]
    *   'person_titles': ["Director of Acquisitions", "VP Acquisitions", "Head of Real Estate", "Managing Partner", "Principal", "Chief Investment Officer"]
2.  **Match & Select:**
    *   From the search results, match them back to the input companies.
    *   Select the ONE best lead per company.
3.  **Email Finding:** Use 'get_person_email' or 'people_enrichment' to get verified emails for selected leads.

### OUTPUT FORMAT
{ "leads": [ { ... } ] }`;

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
        const BATCH_SIZE = 25; // Can handle much larger batches with bulk search

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
