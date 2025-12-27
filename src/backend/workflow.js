import { fileSearchTool, hostedMcpTool, webSearchTool, Agent, Runner, withTrace } from "@openai/agents";
import { startApifyScrape, checkApifyRun, getApifyResults } from "./services/apify.js";
import { z } from "zod";
import { query } from "../../db/index.js";
import {
    getExcludedDomains,
    getExcludedCompanyNames,
    markCompaniesAsResearched,
    getCompanyStats
} from "./company-tracker.js";
import { LeadScraperService } from "./services/lead-scraper-service.js";
import { WORKFLOW_CONFIG, getEffectiveMaxLeads } from "../config/workflow.js";
import { finderBackup, profilerBackup, apolloBackup } from "./workflow_prompts_backup.js";

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

// --- Helper Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Timeout wrapper to prevent infinite hangs
const runWithTimeout = async (fn, timeoutMs, label = 'Operation') => {
    return Promise.race([
        fn(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
        )
    ]);
};

// Timing instrumentation wrapper
const logTiming = (label, logStep) => {
    return async (fn) => {
        const start = Date.now();
        logStep('Timing', `⏱ ${label} started...`);
        try {
            const result = await fn();
            const duration = ((Date.now() - start) / 1000).toFixed(2);
            logStep('Timing', `✅ ${label} completed in ${duration}s`);
            return result;
        } catch (err) {
            const duration = ((Date.now() - start) / 1000).toFixed(2);
            logStep('Timing', `❌ ${label} failed after ${duration}s: ${err.message}`);
            throw err;
        }
    };
};

const retryWithBackoff = async (fn, retries = 2, baseDelay = 500) => {
    try {
        return await fn();
    } catch (error) {
        if (retries === 0) throw error;
        // Check if error is a rate limit or 5xx, or just retry all for now in this MVP
        console.warn(`[Retry] Operation failed: ${error.message}. Retrying in ${baseDelay}ms... (Left: ${retries})`);
        await delay(baseDelay);
        return retryWithBackoff(fn, retries - 1, baseDelay * 2);
    }
};

/**
 * Runs the agent workflow with dynamic vector store inputs.
 * @param {Object} input - Workflow input { input_as_text: string }
 * @param {Object} config - Configuration
 * @param {string} config.vectorStoreId - Vector store ID for knowledge base
 * @param {Object} config.agentConfigs - Agent configurations
 * @param {Object} config.listeners - Event listeners
 * @param {string} config.userId - User ID (required for company tracking)
 * @param {number} config.targetLeads - Total number of leads to collect (default: 50)
 * @param {number} config.maxLeadsPerCompany - Maximum leads per company (default: 3)
 * @param {string} config.mode - Workflow mode ('default' or 'list_builder')
 * @param {Object} config.filters - Lead filtering criteria
 */
export const runAgentWorkflow = async (input, config) => {
    let {
        vectorStoreId,
        agentConfigs = {},
        listeners,
        userId,
        targetLeads = 50, // NEW: Total leads target
        maxLeadsPerCompany = 3, // NEW: Max per company
        minBatchSize = 5,
        maxDiscoveryAttempts = 5,
        mode,
        filters,
        idempotencyKey = null // NEW: Idempotency Key
    } = config;

    // Validate userId requirement
    if (!userId) {
        throw new Error('userId is required for company tracking');
    }

    // Ensure idempotency key is passed to filters for scraper
    if (idempotencyKey) {
        filters = { ...filters, idempotencyKey };
    }

    // Helper for logging
    const logStep = listeners.onLog || ((step, detail) => console.log(`[${step}] ${detail}`));
    const logSection = (title) => logStep('System', `\n=== ${title} ===`);

    if (idempotencyKey) logStep('System', `🔑 Idempotency Key: ${idempotencyKey}`);

    // Default Vector Store Logic
    if (!vectorStoreId) {
        try {
            const result = await query("SELECT value FROM system_config WHERE key = 'default_vector_store'");
            if (result.rows.length > 0 && result.rows[0].value?.id) {
                vectorStoreId = result.rows[0].value.id;
            }
        } catch (e) {
            console.warn("Failed to fetch default vector store", e);
        }
    }

    // --- ENFORCE TESTING LIMITS ---
    const effectiveMaxLeads = getEffectiveMaxLeads();
    if (WORKFLOW_CONFIG.IS_TESTING && targetLeads > effectiveMaxLeads) {
        logStep('System', `⚠️ TESTING MODE ACTIVE: Capping requested ${targetLeads} leads to ${effectiveMaxLeads}.`);
        targetLeads = effectiveMaxLeads;
    } else if (WORKFLOW_CONFIG.IS_TESTING) {
        logStep('System', `🧪 Testing Mode Active (Max ${effectiveMaxLeads} leads/run)`);
    }

    logStep('Workflow', `🎯 Targeting ${targetLeads} total leads (max ${maxLeadsPerCompany} per company).`);

    // --- Fetch Prompts from DB ---
    let agentPrompts = {};
    try {
        const { rows } = await query("SELECT agent_id, system_prompt FROM agent_prompts");
        rows.forEach(row => {
            agentPrompts[row.agent_id] = row.system_prompt;
        });
    } catch (e) {
        console.warn("Failed to fetch agent prompts from DB, using defaults.", e);
    }

    // --- Initialize Tools ---
    // --- Initialize Tools ---
    // Note: We init webSearch inside getToolsForAgent now to allow per-agent logging if needed, 
    // or we just reuse the base instance but wrap it dynamically.
    const webSearch = webSearchTool();
    const apolloMcp = hostedMcpTool({
        serverLabel: "Apollo_Lead_Finder",
        serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01",
        authorization: "apollo-mcp-client-key-01" // Required for the internal check
    });

    // Helper to get tools for an agent
    const getToolsForAgent = (agentKey) => {
        const agentConfig = agentConfigs[agentKey];
        const configEnabledIds = agentConfig?.enabledToolIds;
        const tools = [];

        // 1. File Search Tool (Knowledge Base Access)
        // User Rules: Finder, Profiler, and Outreach Creator need KB access.
        if (vectorStoreId && vectorStoreId.startsWith('vs_') && ['company_finder', 'company_profiler', 'outreach_creator'].includes(agentKey)) {
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
                    enabledIds = ['web_search'];
                    break;
                case 'company_profiler':
                    enabledIds = ['web_search'];
                    break;
                case 'apollo_lead_finder':
                    enabledIds = ['apollo_mcp'];
                    break;
                case 'outreach_creator':
                    enabledIds = []; // File search handled above
                    break;
            }
        }

        // 3. Attach matching tools (with Verbose Wrappers)
        if (enabledIds.includes('apollo_mcp')) {
            tools.push(apolloMcp);
        }
        if (enabledIds.includes('web_search')) {
            // VERBOSE WRAPPER: Intercept web_search calls to log queries
            const verboseWebSearch = {
                ...webSearch,
                execute: async (args, context) => {
                    // Log the search query
                    const query = args.query || args.q || JSON.stringify(args);
                    logStep('Search', `🔍 Googling: "${query}"`);

                    // Execute original tool
                    try {
                        const result = await webSearch.execute(args, context);
                        return result;
                    } catch (e) {
                        logStep('Search', `❌ Failed: ${e.message}`);
                        throw e;
                    }
                }
            };
            tools.push(verboseWebSearch);
        }

        return tools;
    };

    // --- Agent Definitions (Dynamic) ---

    // 1. Company Finder
    // 1. Company Finder
    const finderInst = `You are the "Hunter" Agent for Fifth Avenue Properties.
    GOAL: Find High-Net-Worth Real Estate Investment Firms (Family Offices, Private Equity, institutional investors) in Canada (Toronto, Vancouver, Montreal) and USA.
    
    CRITICAL CRITERIA:
    - MUST be "Equity" investors (Limited Partners/LPs, Co-GPs).
    - EXCLUDE purely "Debt" funds, "Lenders", "Mortgage Brokers", or "Mezzanine" providers.
    - LOOK FOR: "Equity Partner", "Joint Venture", "Capital Placement", "Acquisitions".
    
    SEARCH STRATEGY:
    1. Scan lists like "Top 100 Real Estate Investment Firms in Canada", "Family Offices in Toronto Real Estate".
    2. Check "About Us" or "Investment Criteria" pages.
    3. If they say "We provide debt/financing", SKIP THEM.
    4. If they say "We partner with developers" or "We invest equity", KEEP THEM.`;

    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: finderInst, // Using hardcoded prompt to ensure quality compliance
        model: "gpt-4o",
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler
    const profilerInst = agentPrompts['company_profiler'] || profilerBackup;
    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: profilerInst,
        model: "gpt-4o",
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Lead Finder
    const leadInst = agentPrompts['apollo_lead_finder'] || `You are the Apollo Headhunter Agent... (Default)`;
    const apolloLeadFinder = new Agent({
        name: "Apollo Lead Finder",
        instructions: `You are the Apollo Headhunter Agent for Fifth Avenue Properties.
    Goal: Find decision-makers (Partner, Principal, Director of Acquisitions) at real estate investment firms.

    CRITICAL RULES:
    1. ROLES: "Partner", "Principal", "Managing Director", "Head of Acquisitions", "VP Development".
    2. EXCLUDE: "Loan Originator", "Lender", "Underwriter", "Analyst", "Associate", "Mortgage", "Debt".
    3. ACTION: You MUST use 'people_enrichment' or 'get_person_email' to REVEAL the email.
    4. Do NOT return "email_not_unlocked".
    5. Return valid JSON.`,
        model: "gpt-4o",
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    // 4. Outreach Creator
    const outreachInst = agentPrompts['outreach_creator'] || `You are the Setup Expert... (Default)`;
    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: outreachInst,
        model: "gpt-4o",
        tools: getToolsForAgent('outreach_creator'),
        outputType: OutreachCreatorSchema,
    });

    // --- Runner Execution ---

    return await withTrace("Lead Gen OS (In-House)", async () => {
        const runner = new Runner({
            traceMetadata: {
                __trace_source__: "in-house-agent",
            }
        });

        // 0. Parse Target Parameters from Input
        // Extract targetLeads and maxLeadsPerCompany from user prompt
        // Examples: "Find me 100 leads", "50 leads with max 5 per company"
        const leadsMatch = input.input_as_text.match(/(\d+)\s*leads?/i);
        if (leadsMatch) {
            const parsedLeads = parseInt(leadsMatch[1], 10);
            if (parsedLeads > 0) {
                targetLeads = parsedLeads;
            }
        }

        const maxPerCompanyMatch = input.input_as_text.match(/max(?:imum)?\s*(\d+)\s*(?:leads?\s*)?per\s*company/i);
        if (maxPerCompanyMatch) {
            const parsedMax = parseInt(maxPerCompanyMatch[1], 10);
            if (parsedMax > 0) {
                maxLeadsPerCompany = parsedMax;
            }
        }

        // Enforce Hard Limits
        // targetLeads is already clamped by configuration at start of function
        if (maxLeadsPerCompany > 10) {
            maxLeadsPerCompany = 10;
            logStep('Workflow', 'Max leads per company capped at 10.');
        }

        logStep('Workflow', `🎯 Targeting ${targetLeads} total leads (max ${maxLeadsPerCompany} per company).`);

        // Get company exclusion list from database
        const excludedDomains = await getExcludedDomains(userId);
        const excludedNames = await getExcludedCompanyNames(userId);
        logStep('Workflow', `📊 Excluded ${excludedDomains.length} previously researched companies.`);

        let qualifiedCompanies = [];
        let globalLeads = [];
        let scrapedNamesSet = new Set();
        console.log("DEBUG: Initialized globalLeads and scrapedNamesSet"); // Explicit debug log
        let totalLeadsCollected = 0; // NEW: Track total leads instead of companies
        let leadsPerCompany = {}; // NEW: Track leads collected per company
        let attempts = 0;
        const MAX_ATTEMPTS = 5;
        const originalPrompt = input.input_as_text;

        let lastRoundFound = 0;
        const debugLog = { discovery: [], qualification: [], apollo: [], leadDistribution: {} };

        // --- LOOP: Discovery & Profiling ---
        // NEW: Loop continues until we have enough LEADS (not companies)
        const leadScraper = new LeadScraperService();

        while (totalLeadsCollected < targetLeads && attempts < MAX_ATTEMPTS) {
            attempts++;
            // Calculate how many more LEADS we need
            const leadsNeeded = targetLeads - totalLeadsCollected;

            // Estimate companies needed (assuming each gives ~maxLeadsPerCompany)
            // If we have history of low yield, we could increase this multiplier.
            // For now, simple math: leads / max_per_company
            let companiesNeeded = Math.ceil(leadsNeeded / maxLeadsPerCompany);

            // Minimum batch size to avoid tiny runs
            if (companiesNeeded < minBatchSize) companiesNeeded = minBatchSize;

            logStep('Workflow', `Round ${attempts}: Need ${leadsNeeded} leads. Target: Accumulate ${companiesNeeded} new qualified companies.`);

            // --- STEP 1: ACCUMULATION PHASE ---
            let accumulatedCandidates = []; // Companies found in this round
            let discoveryAttempts = 0;

            while (accumulatedCandidates.length < companiesNeeded && discoveryAttempts < maxDiscoveryAttempts) {
                discoveryAttempts++;
                logStep('Company Finder', `🔎 Discovery Sub-Round ${discoveryAttempts}/${maxDiscoveryAttempts}: Seeking ${companiesNeeded - accumulatedCandidates.length} more companies...`);

                // ENHANCED: Use 4 distinct keyword searches for comprehensive coverage
                const searchStrategies = [
                    `"real estate investment firm" ${input.input_as_text} equity Canada -debt -lender`,
                    `"family office" real estate ${input.input_as_text} Canada equity investment`,
                    `"private equity" real estate ${input.input_as_text} Canada acquisitions development`,
                    `"real estate capital" OR "real estate fund" ${input.input_as_text} Canada equity partner`
                ];

                // Rotate strategies or run all? Running all is fine but might be expensive if done repeatedly.
                // Let's run all for maximum recall.

                const searchPrompt = `
[SYSTEM DIRECTIVE]: You are a Company Discovery Agent tasked with finding real estate investment firms.
SEARCH EXECUTION PROTOCOL:
1. Execute ALL 4 searches below using your 'web_search' tool.
2. Request multiple result pages.
3. AVOID companies already researched: ${[...excludedNames, ...qualifiedCompanies.map(c => c.company_name), ...accumulatedCandidates.map(c => c.company_name)].slice(0, 50).join(', ')}

SEARCH QUERIES:
${searchStrategies.join('\n')}

QUALIFICATION CRITERIA:
✅ INCLUDE: Equity investors, LPs, Co-GPs, Family Offices, Real Estate Funds
❌ EXCLUDE: Debt lenders, mortgage brokers, REITs, property managers

TARGET: Return 20+ candidates to ensure we hit the net target of ${companiesNeeded} after filtering.
OUTPUT: JSON list with company_name, website, capital_role, description
`;

                const finderInput = [{ role: "user", content: searchPrompt }];
                const AGENT_TIMEOUT_MS = 120000;

                let finderResults = [];
                try {
                    const finderRes = await logTiming('Company Finder Agent', logStep)(async () => {
                        return await retryWithBackoff(() =>
                            runWithTimeout(
                                () => runner.run(companyFinder, finderInput),
                                AGENT_TIMEOUT_MS,
                                'Company Finder Agent'
                            )
                        );
                    });

                    if (finderRes.finalOutput && finderRes.finalOutput.results) {
                        finderResults = finderRes.finalOutput.results;
                    }
                } catch (e) {
                    logStep('Company Finder', `⚠️ Agent failed: ${e.message}`);
                }

                if (finderResults.length === 0) {
                    logStep('Company Finder', 'No candidates found in this sub-round.');
                } else {
                    // Filter Duplicates (Global and Local)
                    const newInThisBatch = finderResults.filter(c => {
                        const name = c.company_name;
                        const isResearched = excludedNames.includes(name) ||
                            qualifiedCompanies.some(q => q.company_name === name) ||
                            accumulatedCandidates.some(a => a.company_name === name) ||
                            scrapedNamesSet.has(name);
                        return !isResearched;
                    });

                    logStep('Company Finder', `Found ${finderResults.length} raw. ${newInThisBatch.length} are new unique candidates.`);
                    accumulatedCandidates = [...accumulatedCandidates, ...newInThisBatch];
                }

                if (accumulatedCandidates.length >= companiesNeeded) {
                    logStep('Company Finder', `✅ Target met: ${accumulatedCandidates.length}/${companiesNeeded} companies accumulated.`);
                    break;
                }
            }

            if (accumulatedCandidates.length === 0) {
                logStep('Workflow', '⚠️ Could not find any new companies after max attempts. Stopping workflow.');
                break;
            }

            // --- STEP 2: PROFILING PHASE ---
            logStep('Company Profiler', `Analyzing ${accumulatedCandidates.length} companies...`);

            // We might need to chunk this if it is too huge, but Agent usually handles ~20 okay.
            const profilerInput = [{ role: "user", content: JSON.stringify({ results: accumulatedCandidates }) }];
            const PROFILER_TIMEOUT_MS = 120000;

            let qualifiedInBatch = [];
            try {
                const profilerRes = await logTiming('Company Profiler Agent', logStep)(async () => {
                    return await retryWithBackoff(() =>
                        runWithTimeout(
                            () => runner.run(companyProfiler, profilerInput),
                            PROFILER_TIMEOUT_MS,
                            'Company Profiler Agent'
                        )
                    );
                });

                if (profilerRes.finalOutput && profilerRes.finalOutput.results) {
                    const profilerResults = profilerRes.finalOutput.results;
                    for (const company of profilerResults) {
                        const original = accumulatedCandidates.find(f =>
                            f.company_name.toLowerCase().trim() === company.company_name.toLowerCase().trim()
                        ) || {};
                        const merged = { ...original, ...company };

                        if (merged.company_profile && merged.company_name) {
                            qualifiedInBatch.push(merged);
                            logStep('Company Profiler', `✅ Qualified: ${merged.company_name}`);
                        } else {
                            logStep('Company Profiler', `❌ Rejected: ${merged.company_name}`);
                        }
                    }
                }
            } catch (e) {
                logStep('Company Profiler', `⚠️ Profiling failed: ${e.message}`);
                // Fallback: Skip profiling or accept all? 
                // Let's safe fail and continue with un-profiled accumulation if needed, but better to skip this batch to avoid bad data.
                continue;
            }

            if (qualifiedInBatch.length === 0) {
                logStep('Workflow', 'No companies passed profiling. Retrying discovery...');
                continue;
            }

            qualifiedCompanies = [...qualifiedCompanies, ...qualifiedInBatch];

            // --- STEP 3: LEAD FINDING PHASE ---
            logStep('Lead Finder', `Enriching leads from ${qualifiedInBatch.length} qualified companies...`);

            const activeFilters = config.filters || {};
            // DO NOT set default job_titles here; let apify.js handle defaults to ensure comprehensive coverage.

            try {
                const leads = await leadScraper.fetchLeads(qualifiedInBatch, activeFilters);
                logStep('Lead Finder', `Scrape complete. Retrieved ${leads.length} raw leads.`);

                // Filter for Emails (or keep all based on requirements?)
                // Requirement: "attempts to meet target lead count... contains as many emails as reasonably obtainable"
                // We should prioritize emails but keep LinkedIn-only if that's all we have?
                // The prompt says "Emails are currently the weakest point... LinkedIn profiles and emails are both desired".

                // Let's count emails stats
                const withEmail = leads.filter(l => l.email);
                const withoutEmail = leads.filter(l => !l.email);

                logStep('Lead Finder', `📧 Email Yield: ${withEmail.length}/${leads.length} (${((withEmail.length / leads.length) * 100).toFixed(0)}%)`);

                // If email yield is low, we might want to trigger the "Unstrict" search immediately or flag it.
                // The current scraper logic usually does internal retries if implemented in `fetchLeads`, but `LeadScraperService` implementation 
                // maps standard Apify behavior. 

                // Group by company to enforce limits
                const leadsByCompany = {};
                for (const lead of leads) {
                    const domain = lead.company_domain || lead.company_name;
                    if (!leadsByCompany[domain]) leadsByCompany[domain] = [];
                    leadsByCompany[domain].push(lead);
                }

                for (const [domain, companyLeads] of Object.entries(leadsByCompany)) {
                    // Sorting: Put emails first
                    companyLeads.sort((a, b) => (b.email ? 1 : 0) - (a.email ? 1 : 0));

                    const limited = companyLeads.slice(0, maxLeadsPerCompany);
                    globalLeads.push(...limited);

                    const companyName = companyLeads[0].company_name;
                    // Track in DB
                    try {
                        await markCompaniesAsResearched(userId, [{
                            name: companyName,
                            domain: domain,
                            leadCount: limited.length,
                            metadata: { total_found: companyLeads.length }
                        }]);
                    } catch (err) { /* ignore */ }

                    scrapedNamesSet.add(companyName);
                }

                totalLeadsCollected = globalLeads.length;
                logStep('Lead Finder', `Stats: Found ${leads.length} new leads. Total Pipeline: ${totalLeadsCollected}/${targetLeads}`);

            } catch (err) {
                logStep('Lead Finder', `❌ Enrichment failed: ${err.message}`);
            }

            if (totalLeadsCollected >= targetLeads) {
                logStep('Workflow', `✅ Target reached: ${totalLeadsCollected}/${targetLeads} leads`);
                break;
            }

            const leadsStillNeeded = targetLeads - totalLeadsCollected;
            logStep('Workflow', `🔄 Need ${leadsStillNeeded} more leads. Starting next discovery round...`);

        } // END OF MAIN DISCOVERY LOOP

        // --- Post-Loop Logic ---
        if (globalLeads.length === 0) {
            throw new Error("Workflow failed: No leads collected.");
        }

        // 4. Outreach Creator
        logStep('Outreach Creator', 'Drafting personalized messages...');
        const outreachInput = [{ role: "user", content: JSON.stringify({ leads: globalLeads }) }];

        const outreachRes = await retryWithBackoff(() => runner.run(outreachCreator, outreachInput));
        if (!outreachRes.finalOutput) throw new Error("Outreach Creator failed");

        const outreachOutput = outreachRes.finalOutput;
        const msgCount = outreachOutput.leads ? outreachOutput.leads.length : 0;
        logStep('Outreach Creator', `Drafted messages for ${msgCount} leads.`);

        // 5. Save to CRM (Database)
        logStep('CRM Sync', 'Saving leads to database...');
        try {
            await query('BEGIN');
            for (const lead of outreachOutput.leads) {
                await query(
                    `INSERT INTO leads (user_id, company_name, person_name, email, job_title, linkedin_url, status, custom_data, source)
                     VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, 'Automation')`,
                    [
                        userId, // Inject userId
                        lead.company_name,
                        `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
                        lead.email,
                        lead.title,
                        lead.linkedin_url,
                        JSON.stringify({
                            company_website: lead.company_website,
                            company_profile: lead.company_profile,
                            connection_request: lead.connection_request,
                            email_message: lead.email_message,
                            verification_date: new Date().toISOString()
                        })
                    ]
                );
            }
            await query('COMMIT');
            logStep('CRM Sync', `Successfully saved ${outreachOutput.leads.length} leads to CRM.`);
        } catch (dbErr) {
            await query('ROLLBACK');
            logStep('CRM Sync', `Failed to save leads to DB: ${dbErr.message}`);
            // Don't fail the whole workflow check if DB fails, but log it.
        }

        return {
            status: "success",
            leads: outreachOutput.leads,
            debug: debugLog
        };
    });
};

/**
 * Enriches a specific lead with phone numbers using Apollo MCP.
 * @param {Object} lead - Lead object ({ first_name, last_name, company_name, email, linkedin_url })
 */
export const enrichLeadWithPhone = async (lead) => {
    // Schema for phone enrichment
    const PhoneSchema = z.object({
        phone_numbers: z.array(z.object({
            sanitized_number: z.string(),
            type: z.string()
        })).optional()
    });

    const apolloMcp = hostedMcpTool({
        serverLabel: "Apollo_Lead_Finder",
        serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01",
        authorization: "apollo-mcp-client-key-01"
    });

    const enricherAgent = new Agent({
        name: "Phone Enricher",
        instructions: `You are an expert helper. Your ONLY goal is to find phone numbers for the provided person.
        
        STRATEGY:
        1. Use 'people_enrichment' tool.
        2. Pass the EXACT parameters from the input:
           - email: "${lead.email}" (Primary Identifier)
           - linkedin_url: "${lead.linkedin_url}" (Secondary Identifier)
           - first_name: "${lead.first_name}"
           - last_name: "${lead.last_name}"
           - organization_name: "${lead.company_name}"
        3. If 'people_enrichment' returns phone numbers, output them immediately.
        
        Input Data: ${JSON.stringify(lead)}
        RETURN ONLY JSON with a list of phone numbers found.`,
        model: "gpt-4o",
        tools: [apolloMcp],
        outputType: PhoneSchema
    });

    const runner = new Runner();
    const result = await runner.run(enricherAgent, [
        { role: "user", content: "Enrich this person with phone numbers." }
    ]);

    return result.finalOutput?.phone_numbers || [];
};
