
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
    const finderDefaultInst = `You are the Discovery Agent for Hazen Road, a one hundred seventy eight unit build to rent project in Buckeye, Arizona in an Opportunity Zone.
    
    You have access to a Google Sheet tool.
    Target Spreadsheet ID: "${sheetId || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'}"
    Sheet Name: "Companies"

    My Instructions:
    1. Extract 'target_count' from the user input (default to 10 if not found).
    2. FIRST, read the "Companies" sheet/tab in the spreadsheet to get a list of already found companies. You must EXCLUDE these from your search results.
    3. Use web search to find relevant companies based on the user's query (e.g., build to rent, opportunity zone, multifamily investors).
    4. You MUST continue searching and finding companies until you have precisely 'target_count' *new* companies that are not in the exclusion list.
    5. Do NOT stop after the first search if you haven't reached the count. Loop your search tool calls until the count is met.
    
    Output JSON Schema:
    { "results": [ ... ] }`;

    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: getInstructions('company_finder', finderDefaultInst),
        model: "gpt-5.2", // Superior reasoning (500k TPM limit)
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler
    const profilerDefaultInst = `You are the Company Profiler. You receive input.results as an array of company objects.
    Your job is to filter out irrelevant firms and create a concise narrative profile for each company that matches our investment thesis.
    Use the “Target Audience or Research Guide” knowledge file (via file search) to understand relevance.
    
    For each company:
    - Use web search to confirm multifamily/BTR/Opportunity Zone/Sunbelt exposure.
    - Confirm LP/JV/Co-GP role.
    - If irrelevant, DISCARD it.
    - If relevant, write a 2-5 sentence 'company_profile' based on usage of tools.
    
    Tone: Natural, confident, warm LinkedIn intro style. No citations/AUM figures.
    
    Output format:
    { "results": [ { "company_name": "", "domain": "", "company_profile": "" } ] }`;

    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: getInstructions('company_profiler', profilerDefaultInst),
        model: "gpt-5-mini", // High volume/throughput (500k TPM)
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo Lead Finder
    const leadDefaultInst = `You are Apollo Lead Ops. You receive input.results (company profiles). Identify up to 3 senior US-based capital decision makers per company.
    
    Tools: organization_search, employees_of_company, people_search, people_enrichment, get_person_email.
    
    Step 1: Resolve Org Identity (organization_search).
    Step 2: Retrieve Decision Makers (employees_of_company or people_search).
       Rank: CIO > Founder > Partner > Head > VP.
       Location: US only.
       Limit: 3 leads per company.
    Step 3: Enrich & Get Email (people_enrichment, get_person_email).
    
    Attach the original 'company_profile' to each lead.
    
    Output JSON:
    { "leads": [ { ... } ] }`;

    const apolloLeadFinder = new Agent({
        name: "Apollo Lead Finder",
        instructions: getInstructions('apollo_lead_finder', leadDefaultInst),
        model: "gpt-5-mini", // High volume/throughput
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    // 4. Outreach Creator
    const outreachDefaultInst = `You are the Outreach Creation Agent.
    For each lead in input.leads:
    - Read 'company_profile'.
    - Use "Outreach Framework" (via file search) for tone/style.
    - Write 'connection_request' (max 300 chars).
    - Write 'email_message' (max 300 chars, first touch, grounded in profile).
    
    Return the enriched lead objects in the JSON schema.`;

    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: getInstructions('outreach_creator', outreachDefaultInst),
        model: "gpt-5.2", // Best quality for writing
        tools: getToolsForAgent('outreach_creator'),
        outputType: OutreachCreatorSchema,
    });

    // 5. Sheet Builder
    const sheetBuilderDefaultInst = `You are the Sheet Builder Agent.
    
    Target Spreadsheet ID: "${sheetId || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'}"
    Target Sheet Name: "AI Lead Sheet"
    
    Your job:
    1. Read 'input.leads'.
    2. Write/Append these leads to the "AI Lead Sheet" in the spreadsheet above.
       Columns: Date Added, First Name, Last Name, Company, Title, Email, LinkedIn, Website, Connection Request, Email Message, Profile.
    3. Return the full spreadsheet URL (e.g. https://docs.google.com/spreadsheets/d/${sheetId || '1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI'}/edit) and status "success".
    
    Use the 'insert_row' tool (or 'append_row' if you have it, otherwise loop insert_row).`;

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

        // 1. Company Finder
        logStep('Company Finder', 'Identifying potential companies...');
        // Initial input
        const finderInput = [{ role: "user", content: [{ type: "input_text", text: input.input_as_text }] }];

        const finderRes = await retryWithBackoff(() => runner.run(companyFinder, finderInput));
        if (!finderRes.finalOutput) throw new Error("Company Finder failed");

        const finderOutput = finderRes.finalOutput;
        logStep('Company Finder', `Found ${finderOutput.results?.length} companies.`);

        // 2. Profiler
        logStep('Company Profiler', 'Filtering and profiling companies...');
        // Pass clean input from previous output
        const profilerInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(finderOutput) }] }];

        const profilerRes = await retryWithBackoff(() => runner.run(companyProfiler, profilerInput));
        if (!profilerRes.finalOutput) throw new Error("Profiler failed");

        const profilerOutput = profilerRes.finalOutput;
        logStep('Company Profiler', `Profiled ${profilerOutput?.results?.length} qualified companies.`);

        // 3. Lead Finder
        logStep('Apollo Lead Finder', 'Finding decision makers...');
        // Pass clean input from previous output
        const leadInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(profilerOutput) }] }];

        const leadRes = await retryWithBackoff(() => runner.run(apolloLeadFinder, leadInput));
        if (!leadRes.finalOutput) throw new Error("Apollo Lead Finder failed");

        const leadOutput = leadRes.finalOutput;
        logStep('Apollo Lead Finder', 'Leads found and enriched.');

        // 4. Outreach Creator
        logStep('Outreach Creator', 'Drafting personalized messages...');
        // Pass clean input from previous output
        const outreachInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(leadOutput) }] }];

        const outreachRes = await retryWithBackoff(() => runner.run(outreachCreator, outreachInput));
        if (!outreachRes.finalOutput) throw new Error("Outreach Creator failed");

        const outreachOutput = outreachRes.finalOutput;
        logStep('Outreach Creator', 'Messages drafted.');

        // 5. Sheet Builder
        logStep('Sheet Builder', 'Exporting to Google Sheets...');
        // Pass clean input from previous output
        const sheetInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(outreachOutput) }] }];

        const sheetRes = await retryWithBackoff(() => runner.run(sheetBuilder, sheetInput));
        if (!sheetRes.finalOutput) throw new Error("Sheet Builder failed");

        logStep('Sheet Builder', 'Export complete.');

        // Return structured result containing sheet URL and the actual lead data for the logbook
        return {
            ...sheetRes.finalOutput,
            leads: outreachOutput.leads
        };
    });
};
