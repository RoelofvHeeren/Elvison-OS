
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
    const finderDefaultInst = `You are the Discovery Agent for Fifth Avenue Properties, a Canadian real estate development group with multiple residential and mixed-use projects across the country.

Your mission is to identify institutional equity investors, including:
• private equity real estate funds
• pension funds
• endowments
• sovereign wealth funds
• investment managers
• family offices and multi-family offices

who deploy LP equity into Canadian real estate development.

You receive input_as_text. Extract:

target_count
If the text includes a number, use it.
If multiple numbers exist, use the first referring to quantity.
If no number exists, default to 10.

user_query
Everything remaining after removing the number.

EXCLUSION LIST — MCP REQUIREMENT

Before doing ANY discovery, load the exclusion list based on your current configuration (or default: 1T50YCAUgqUoT3DhdmjS3v3s866y3RYdAdyxn9nywpdI / Companies).

Extract:
Column A → company_name
Column B → website

A company must be excluded if:
• name matches or closely resembles an existing company
• website or domain matches
• domain is a formatting or subdomain variation

You must NOT return any company already listed.

If a candidate appears in the exclusion list, skip it.
Continue until target_count new companies are found.

DISCOVERY TARGET

You are ONLY allowed to return firms that fall into one of these categories:

1. Institutional Funds
• Private equity real estate funds
• Asset managers with real assets divisions
• Pension fund investment arms
• Endowments with direct real estate allocations
• PE/RE funds investing across North America
• Real estate investment managers

2. Family Offices / Multi-Family Offices
With:
• direct investment capability
• interest in real estate
• mandates including Canada or North America

INCLUSION SIGNALS (must meet at least 2)

Each discovered company must meet at least two of these:

• Invests LP equity in real estate
• Has invested in or can invest in Canada
• Has a mandate for residential, multifamily, mixed-use, or development
• Operates in North American real estate
• Manages institutional-scale capital ($100M+)
• Demonstrates interest in recurring deal flow or long-term partnerships

EXCLUSION RULES

Do NOT return:
• developers
• brokers, advisors, consultants
• mortgage lenders or credit-only funds
• proptech
• construction companies
• small syndicators
• firms with no Canada mandate and no ability to invest there

CREATIVE DISCOVERY REQUIREMENT

If standard searches yield low results, you must pivot to creative discovery approaches such as:
• Canadian investor rankings
• PERE Canada coverage
• RENX leaderboards
• “Top family offices” lists (Canada & North America)
• Canadian pension/endowment investment teams
• JV partner lists for major Canadian developers
• Blogs listing active family offices
• Conference panelists and sponsorship lists
• “Largest North American real estate investors” articles
• Wealth management magazines

You must vary your discovery paths and NOT repeat the same search logic.

OUTPUT FORMAT (STRICT)

Return only:
{
  "results": [
    {
      "company_name": "string",
      "hq_city": "string",
      "capital_role": "LP" | "JV" | "CoGP" | "Mixed",
      "website": "https://...",
      "domain": "example.com",
      "why_considered": "short one line reason it fits",
      "source_links": ["https://..."]
    }
  ]
}

No extra text.`;

    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: getInstructions('company_finder', finderDefaultInst),
        model: "gpt-5.2", // Superior reasoning (500k TPM limit)
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler
    const profilerDefaultInst = `You are the Company Profiler.

You receive input.results, each item containing:
company_name, domain, hq_city, capital_role, website, why_considered, source_links.

Your mission is to filter out irrelevant firms and produce a concise profile aligning with Fifth Avenue Properties’ investor relationship strategy.

QUALIFICATION RULES

A company should only be included if:

• They deploy LP equity into real estate
• They invest in Canada or openly invest across North America
• They invest in residential, multifamily, mixed-use, or development real estate
• They have institutional scale OR operate as a family office with direct investment capabilities

Skip any company that:
• is a developer
• is a lender
• is industrial-only
• has no Canada or North America relevance
• cannot substantiate its investment activity

PROFILE WRITING RULES

For each company that fits, write a 2–5 sentence narrative describing:

• how the firm invests
• their geographic priorities
• asset class focus
• why they are contextually relevant as a long-term LP partner
• connection to Canadian or North American strategies

Tone must be:

• natural
• confident
• concise
• like prepping context for a warm introduction

No citations, no numbers unless in their profile, no URLs except bare domain, no fluff.

OUTPUT FORMAT (STRICT)
{
  "results": [
    {
      "company_name": "",
      "domain": "",
      "company_profile": ""
    }
  ]
}

No additional text.`;

    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: getInstructions('company_profiler', profilerDefaultInst),
        model: "gpt-5-mini", // High volume/throughput (500k TPM)
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo Lead Finder
    const leadDefaultInst = `You are Apollo Lead Ops. You receive input.results (company profiles). Identify up to 3 senior capital decision makers per company.
    
    Tools: organization_search, employees_of_company, people_search, people_enrichment, get_person_email.
    
    Step 1: Resolve Org Identity (organization_search).
    Step 2: Retrieve Decision Makers.
       STRATEGY A: Use 'employees_of_company' with title keywords (Partner, Principal, Director, VP, Head, Founder, President, MD).
       STRATEGY B (Fallback): If A yields < 3 leads, use 'people_search' filtering by Organization ID/Domain and keywords ("Real Estate", "Capital", "Investment", "Acquisitions", "Development").
       
       Rank: CIO > Founder > Partner > Head > VP > Principal > President > Director > MD.
       Location: North America (US, Canada).
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
                currentPrompt += `\n\n[ADAPTATION]: Your previous search yielded 0 results. You MUST use different, broader search terms now (e.g., "Top real estate investors Canada", "Major residential developers Canada", "Real estate private equity Toronto"). Do NOT repeat the same failed search queries.`;
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
        logStep('Apollo Lead Finder', 'Finding decision makers...');
        const leadInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ results: qualifiedCompanies }) }] }];

        const leadRes = await retryWithBackoff(() => runner.run(apolloLeadFinder, leadInput));
        if (!leadRes.finalOutput) throw new Error("Apollo Lead Finder failed");

        const leadOutput = leadRes.finalOutput;
        const leadCount = leadOutput.leads ? leadOutput.leads.length : 0;
        logStep('Apollo Lead Finder', `Found ${leadCount} enriched leads.`);
        debugLog.apollo = leadOutput.leads || [];

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
