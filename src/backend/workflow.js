

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
        const tools = [];

        // 1. File Search Tool (if files are linked)
        if (agentConfig?.linkedFileIds?.length > 0) {
            tools.push(fileSearchTool(agentConfig.linkedFileIds));
        } else if (vectorStoreId) {
            // Fallback to global vector store if no specific files linked
            tools.push(fileSearchTool([vectorStoreId]));
        }

        // 2. MCP Tools (based on enabledToolIds)
        const enabledIds = agentConfig?.enabledToolIds || [];

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
    You receive a single string as input under the variable input_as_text. Your first job is to extract two values:
    1. target_count
    If the input text includes a number, use it as target_count.
    If multiple numbers exist, use the first one that clearly refers to quantity.
    If none exist, default target_count to 10.
    2. user_query
    The remainder of the text after removing the extracted number. This may include preferences, markets, capital roles, or focus areas.
    
    IMPORTANT: You must return valid JSON matching the schema.`;

    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: getInstructions('company_finder', finderDefaultInst),
        model: "gpt-4o",
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler
    const profilerDefaultInst = `You are the Company Profiler. You receive input.results as an array of company objects, each containing company_name, hq_city, capital_role, website, domain, why_considered, and source_links.
    Your job is to filter out irrelevant firms and create a concise narrative profile for each company that matches our investment thesis.
    Use the “Target Audience or Research Guide” knowledge file to understand which firms are relevant. This includes investment style, market focus, asset strategies, and capital role alignment.
    For each company
    Use web search or internal knowledge files to confirm whether the firm invests in multifamily or build to rent, and whether they have any Sunbelt, Phoenix, or Opportunity Zone exposure.
    Confirm that they typically invest as LP, JV, or co GP in growth market strategies.
    If the company clearly does not fit the thesis, skip it completely and do not return it.
    If relevant, write a two to five sentence company_profile based on: • how the firm invests • the markets they prioritise • their asset class focus • why they are contextually relevant to conversations about build to rent or growth markets
    Rules for company_profile Write like you are preparing context for a warm LinkedIn introduction. The tone should be natural, confident, and concise. No citations, no bullet lists, no URLs other than the bare domain, and no AUM figures. Do not reference the Target Audience Guide explicitly. Do not include meta explanations or analysis outside the JSON.
    Output format Return only this JSON object.
    { "results": [ { "company_name": "", "domain": "", "company_profile": "" } ] }
    No text outside the JSON.`;

    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: getInstructions('company_profiler', profilerDefaultInst),
        model: "gpt-4o",
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo Lead Finder
    const leadDefaultInst = `You are Apollo Lead Ops. You receive input.results as an array of company objects containing company_name, domain, and company_profile. Your job is to identify up to three senior US-based capital decision makers per company using Apollo MCP tools only, enrich them, and return a clean lead list.
    🛠 Allowed Tools
    Use only these tools: organization_search, employees_of_company, people_search, people_enrichment, get_person_email, organization_enrichment
    ❌ Do not call Web Search, AI Research, or any other tools.
    📌 Every tool call must include a reasoning field: a one-sentence justification for calling that tool.
    🧭 Workflow
    🔹 Step 1: Resolve the organization identity
    Call organization_search using company_name and domain. Reasoning: “Resolve organization identity to retrieve employees.” Select the best match based on name and domain.
    🔹 Step 2: Retrieve US-based decision makers
    Call employees_of_company using the organization ID or domain. Reasoning: “List senior investment decision makers based in the US.”
    If results are sparse, backfill using people_search with company_name, title filters, and US-only location filters. Reasoning: “Backfill US-based senior decision makers by title.”
    Title Filters: Include: CIO, CEO, President, Founder, Co Founder, Managing Partner, General Partner, Principal, Head of Investments, Head of Capital Markets, Head of Portfolio Management, Head of Strategy, Director of Investments, Director of Capital Markets, VP of Investments, VP of Capital Markets, SVP, EVP Exclude: Analyst, Associate, Coordinator, Assistant, Intern, Consultant, SDR, AE, BD unless clearly labeled investor relations or capital raising.
    Geography Constraint: Only select people located in the United States.
    Ranking Logic: Prefer: C-level > Partner/Founder > Head/Director > VP Limit to 3 leads per company.
    🔹 Step 3: Enrich each contact
    Call people_enrichment to verify title and fetch LinkedIn URL. Reasoning: “Confirm title and get LinkedIn URL.”
    Call get_person_email to retrieve best deliverable email. Reasoning: “Fetch best deliverable email.”
    🧹 Deduplication: Deduplicate contacts by email or LinkedIn URL. 🧷 Attach the original company_profile unchanged to each lead.
    📤 Output Format
    Return this JSON:
    {   "leads": [     {       "date_added": "YYYY-MM-DD",       "first_name": "",       "last_name": "",       "company_name": "",       "title": "",       "email": "",       "linkedin_url": "",       "company_website": "",       "company_profile": ""     }   ] } 
    🕒 date_added must be today in UTC in YYYY-MM-DD format 🌐 company_website: Use the input domain or enriched org domain 🔍 Use empty strings for missing values 📦 Return JSON only, with no extra text or explanation`;

    const apolloLeadFinder = new Agent({
        name: "Apollo Lead Finder",
        instructions: getInstructions('apollo_lead_finder', leadDefaultInst),
        model: "gpt-4o",
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    // 4. Outreach Creator
    const outreachDefaultInst = `You are the Outreach Creation Agent. You receive input.leads as an array of lead objects. Each lead already contains date_added, first_name, last_name, company_name, title, email, linkedin_url, company_website, and company_profile.
    Your job is to create personalised outreach messaging for each lead using the “Outreach Framework” vector store.
    For each lead Read the company_profile carefully. This explains the company’s investment style, geographic focus, asset preferences, and relevance to build to rent or growth market strategies. Use the Outreach Framework file to determine tone, structure, and personalisation strategy.
    Write a LinkedIn connection_request, maximum 300 characters. It must feel personal, reference something specific about the company_profile, and follow the Outreach Framework style rules.
    Write a first touch email_message, maximum 300 characters. It must be concise, natural, tailored to the lead’s investment focus, and grounded in the company_profile. No generic templates.
    Rules Do not modify date_added or company_profile. Do not change factual contact details. Do not include explanations. Return JSON only with no text outside the object.
    Output format Return this exact JSON object:
    { "leads": [ { "date_added": "", "first_name": "", "last_name": "", "company_name": "", "title": "", "email": "", "linkedin_url": "", "company_website": "", "connection_request": "", "email_message": "", "company_profile": "" } ] }`;

    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: getInstructions('outreach_creator', outreachDefaultInst),
        model: "gpt-4o",
        tools: getToolsForAgent('outreach_creator'),
        outputType: OutreachCreatorSchema,
    });

    // 5. Sheet Builder
    const sheetBuilderDefaultInst = `You are the Sheet Builder Agent. You receive input.leads containing enriched leads with outreach messages.
    Your job is to write these leads to a Google Sheet.
    1. Create a new spreadsheet or use an existing one if a sheetId is provided in context (though typically we create new for a batch). Title it "Hazen Road Leads - [Date]".
    2. Create a header row with: Date Added, First Name, Last Name, Company, Title, Email, LinkedIn, Website, Connection Request, Email Message, Profile.
    3. Write all leads to the sheet.
    4. Return the spreadsheet URL and status "success".
    Output JSON: { "spreadsheet_url": "...", "status": "success" }`;

    const sheetBuilder = new Agent({
        name: "Sheet Builder",
        instructions: getInstructions('sheet_builder', sheetBuilderDefaultInst),
        model: "gpt-4o",
        tools: getToolsForAgent('sheet_builder'),
        outputType: SheetBuilderSchema,
    });

    // --- Runner Execution ---

    return await withTrace("Lead Gen OS (In-House)", async () => {
        const runner = new Runner({
            traceMetadata: {
                __trace_source__: "in-house-agent",
            }
        });

        const conversationHistory = [
            { role: "user", content: [{ type: "input_text", text: input.input_as_text }] }
        ];

        // 1. Company Finder
        logStep('Company Finder', 'Identifying potential companies...');
        const finderRes = await runner.run(companyFinder, [...conversationHistory]);
        if (!finderRes.finalOutput) throw new Error("Company Finder failed");

        const finderOutput = finderRes.finalOutput;
        logStep('Company Finder', `Found ${finderOutput.results?.length} companies.`);
        conversationHistory.push(...finderRes.newItems.map(i => i.rawItem));

        // 2. Profiler
        logStep('Company Profiler', 'Filtering and profiling companies...');
        const profilerRes = await runner.run(companyProfiler, [...conversationHistory]);
        if (!profilerRes.finalOutput) throw new Error("Profiler failed");

        const profilerOutput = profilerRes.finalOutput;
        logStep('Company Profiler', `Profiled ${profilerOutput?.results?.length} qualified companies.`);
        conversationHistory.push(...profilerRes.newItems.map(i => i.rawItem));

        // 3. Lead Finder
        logStep('Apollo Lead Finder', 'Finding decision makers...');
        const leadRes = await runner.run(apolloLeadFinder, [...conversationHistory]);
        if (!leadRes.finalOutput) throw new Error("Apollo Lead Finder failed");

        logStep('Apollo Lead Finder', 'Leads found and enriched.');
        conversationHistory.push(...leadRes.newItems.map(i => i.rawItem));

        // 4. Outreach Creator
        logStep('Outreach Creator', 'Drafting personalized messages...');
        const outreachRes = await runner.run(outreachCreator, [...conversationHistory]);
        if (!outreachRes.finalOutput) throw new Error("Outreach Creator failed");

        logStep('Outreach Creator', 'Messages drafted.');
        conversationHistory.push(...outreachRes.newItems.map(i => i.rawItem));

        // 5. Sheet Builder
        logStep('Sheet Builder', 'Exporting to Google Sheets...');
        const sheetRes = await runner.run(sheetBuilder, [...conversationHistory]);
        if (!sheetRes.finalOutput) throw new Error("Sheet Builder failed");

        logStep('Sheet Builder', 'Export complete.');
        return sheetRes.finalOutput;
    });
};
