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
        mode,
        filters
    } = config;

    // Validate userId requirement
    if (!userId) {
        throw new Error('userId is required for company tracking');
    }

    // Helper for logging
    const logStep = (step, detail) => {
        if (listeners && listeners.onLog) {
            listeners.onLog({ step, detail });
        } else {
            console.log(`[${step}] ${detail}`);
        }
    };

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
    const profilerInst = agentPrompts['company_profiler'] || `You are the Research Analyst... (Default)`;
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
        if (targetLeads > 200) {
            targetLeads = 200;
            logStep('Workflow', 'Target leads capped at 200 (System Limit).');
        }
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
        let totalLeadsCollected = 0; // NEW: Track total leads instead of companies
        let leadsPerCompany = {}; // NEW: Track leads collected per company
        let attempts = 0;
        const MAX_ATTEMPTS = 5;
        const originalPrompt = input.input_as_text;

        let lastRoundFound = 0;
        const debugLog = { discovery: [], qualification: [], apollo: [], leadDistribution: {} };

        // --- LOOP: Discovery & Profiling ---
        // NEW: Loop continues until we have enough LEADS (not companies)
        while (totalLeadsCollected < targetLeads && attempts < MAX_ATTEMPTS) {
            attempts++;
            // Calculate how many more LEADS we need
            const leadsNeeded = targetLeads - totalLeadsCollected;
            // Estimate companies needed (assuming each gives ~maxLeadsPerCompany)
            const companiesNeeded = Math.ceil(leadsNeeded / maxLeadsPerCompany);

            // Only log if this is a re-run or substantial update
            if (attempts > 1) {
                logStep('Workflow', `Round ${attempts}: Need ${leadsNeeded} more leads (~${companiesNeeded} companies). Collected ${totalLeadsCollected}/${targetLeads} leads so far.`);
            } else {
                logStep('Company Finder', `🚀 Starting Turbo Discovery (Target: ${companiesNeeded} companies for ${leadsNeeded} leads)...`);
            }

            // We removed the 'switch' statement because Turbo Mode handles strategy by running all queries in parallel.



            // TURBO MODE: Parallel Search Execution via Agent
            // We command the agent to run multiple searches to broaden the net.

            // ENHANCED: Use 4 distinct keyword searches for comprehensive coverage
            // Each search should return multiple pages of results (not just 10)
            const searchStrategies = [
                `"real estate investment firm" ${input.input_as_text} equity Canada -debt -lender`,
                `"family office" real estate ${input.input_as_text} Canada equity investment`,
                `"private equity" real estate ${input.input_as_text} Canada acquisitions development`,
                `"real estate capital" OR "real estate fund" ${input.input_as_text} Canada equity partner`
            ];

            logStep('Company Finder', `🚀 Multi-Search Strategy: 4 distinct keyword searches for ${companiesNeeded} companies...`);

            // Build exclusion list for agent prompt
            const currentlyProcessed = qualifiedCompanies.map(c => c.company_name);
            const allExcluded = [...new Set([...excludedNames, ...currentlyProcessed])];
            const exclusionText = allExcluded.length > 0
                ? `\n\nCRITICAL EXCLUSIONS - DO NOT INCLUDE:\n${allExcluded.slice(0, 30).join(', ')}${allExcluded.length > 30 ? `\n...and ${allExcluded.length - 30} more previously researched companies` : ''}`
                : '';

            const searchPrompt = `
[SYSTEM DIRECTIVE]: You are a Company Discovery Agent tasked with finding ${companiesNeeded} real estate investment firms.

SEARCH EXECUTION PROTOCOL:
1. Execute ALL 4 searches below using your 'web_search' tool
2. For EACH search, request multiple result pages (aim for 20-30 results per search)
3. You should perform ~4-8 total web_search calls to gather comprehensive results

SEARCH QUERIES (execute ALL):
Strategy A: ${searchStrategies[0]}
Strategy B: ${searchStrategies[1]}
Strategy C: ${searchStrategies[2]}
Strategy D: ${searchStrategies[3]}

WEBSITE INVESTIGATION PROTOCOL:
After collecting search results:
1. Visit the websites of promising companies (aim for 20-40 site visits)
2. Look for these pages: About Us, Investment Criteria, Portfolio, Team
3. Extract: Company name, website, investment focus, equity vs debt
4. Prioritize companies that clearly state "equity investment" or "joint venture"

QUALIFICATION CRITERIA:
✅ INCLUDE: Equity investors, LPs, Co-GPs, Family Offices, Real Estate Funds
❌ EXCLUDE: Debt lenders, mortgage brokers, REITs, property managers${exclusionText}

TARGET: Return exactly ${companiesNeeded} qualified companies
OUTPUT: JSON list with company_name, website, capital_role, description

SPEED vs ACCURACY: Accuracy is priority. Take time to visit websites and verify they match criteria.
`;

            const finderInput = [{ role: "user", content: [{ type: "input_as_text", text: searchPrompt }] }];

            // Add timeout and timing instrumentation
            const AGENT_TIMEOUT_MS = 120000; // 2 minutes max
            const finderRes = await logTiming('Company Finder Agent', logStep)(async () => {
                return await retryWithBackoff(() =>
                    runWithTimeout(
                        () => runner.run(companyFinder, finderInput),
                        AGENT_TIMEOUT_MS,
                        'Company Finder Agent'
                    )
                );
            });

            if (!finderRes.finalOutput) {
                logStep('Company Finder', 'Agent failed to return output. Retrying...');
                continue;
            }

            const finderResults = finderRes.finalOutput.results || [];
            lastRoundFound = finderResults.length;
            debugLog.discovery.push({ round: attempts, results: finderResults });

            if (finderResults.length === 0) {
                logStep('Company Finder', 'No new companies found in this batch.');
                if (attempts >= 2) break;
                continue;
            }

            logStep('Company Finder', `Found ${finderResults.length} candidates. Profiling...`);

            // 2. Profiler
            const profilerInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ results: finderResults }) }] }];
            const PROFILER_TIMEOUT_MS = 90000; // 1.5 minutes
            const profilerRes = await logTiming('Company Profiler Agent', logStep)(async () => {
                return await retryWithBackoff(() =>
                    runWithTimeout(
                        () => runner.run(companyProfiler, profilerInput),
                        PROFILER_TIMEOUT_MS,
                        'Company Profiler Agent'
                    )
                );
            });

            if (!profilerRes.finalOutput) {
                logStep('Company Profiler', 'Agent failed. Skipping this batch.');
                continue;
            }

            const profilerResults = profilerRes.finalOutput.results || [];
            const qualifiedInBatch = [];

            for (const company of profilerResults) {
                // Find original to preserve 'website' and distinct inputs
                const original = finderResults.find(f =>
                    f.company_name.toLowerCase().trim() === company.company_name.toLowerCase().trim()
                ) || {};

                const merged = { ...original, ...company }; // Profiler fields override, but original fields persist

                if (merged.company_profile && merged.company_name) {
                    if (!qualifiedCompanies.some(c => c.company_name === merged.company_name)) {
                        logStep('Company Profiler', `✅ Qualified: ${merged.company_name}`);
                        qualifiedInBatch.push(merged);
                    } else {
                        logStep('Company Profiler', `ℹ️ Duplicate: ${merged.company_name}`);
                    }
                } else {
                    logStep('Company Profiler', `❌ Rejected: ${merged.company_name || 'Unknown'} (Insufficient Profile)`);
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

        // --- LIST BUILDER MODE ---
        // If mode is 'list_builder', we stop here and return the companies so the user can export them manually.
        if (config.mode === 'list_builder') {
            logStep('Workflow', 'Mode is "List Builder". Skipping enrichment. Returning company list.');
            return {
                status: "success",
                type: "list_builder",
                companies: qualifiedCompanies,
                debug: debugLog
            };
        }

        // 3. Lead Finder (PipelineLabs Scraper)
        logStep('Lead Finder', 'Enriching leads via PipelineLabs Scraper...');

        let allLeads = [];

        // Extract company names from qualified companies
        // We no longer extract domains for the search usage, but we keep the qualifiedCompanies objects as they are.
        const targetCompanies = qualifiedCompanies.map(c => c.company_name).filter(n => n && n.trim().length > 0);

        // USER REQUESTED "GOLD STANDARD" TITLES
        const GOLD_STANDARD_TITLES = [
            "CEO", "Founder", "Co-Founder", "Owner", "Principal",
            "Founding Partner", "Managing Partner", "Partner",
            "Director of Investments", "Director of Developments",
            "Vice President", "President", "CIO", "COO"
        ];

        // Merge defaults if user didn't specify strict titles
        const activeFilters = config.filters || {};
        if (!activeFilters.job_titles || activeFilters.job_titles.length === 0) {
            activeFilters.job_titles = GOLD_STANDARD_TITLES;
        }

        if (targetCompanies.length === 0) {
            console.warn("No valid companies found for scraping.");
        } else {
            logStep('Lead Finder', `Starting scrape for ${targetCompanies.length} companies...`);

            try {
                // Trigger Apify Run
                // Pass Company Names (name-based search)
                const runId = await startApifyScrape(process.env.APIFY_API_TOKEN, targetCompanies, activeFilters);
                logStep('Lead Finder', `Job started (ID: ${runId}). Waiting for results...`);

                // Poll for completion
                let isComplete = false;
                let datasetId = null;
                const POLL_INTERVAL = 5000;
                let attempts = 0;
                const MAX_WAIT = 600; // 10 minutes max wait?

                while (!isComplete && attempts < MAX_WAIT) {
                    await delay(POLL_INTERVAL);
                    const statusRes = await checkApifyRun(process.env.APIFY_API_TOKEN, runId);

                    if (statusRes.status === 'SUCCEEDED') {
                        isComplete = true;
                        datasetId = statusRes.datasetId;
                    } else if (statusRes.status === 'FAILED' || statusRes.status === 'ABORTED') {
                        throw new Error(`Apify run failed with status: ${statusRes.status}`);
                    }
                    attempts++;
                }

                if (datasetId) {
                    const rawItems = await getApifyResults(process.env.APIFY_API_TOKEN, datasetId);
                    logStep('Lead Finder', `Scrape complete. Retrieved ${rawItems.length} leads.`);

                    // Map specific PipelineLabs output to our standard Lead Schema for Outreach Creator
                    const rawLeads = rawItems.map(item => {
                        // Parse Name
                        let firstName = item.firstName || item.first_name || '';
                        let lastName = item.lastName || item.last_name || '';
                        if (!firstName && item.fullName) {
                            const parts = item.fullName.split(' ');
                            firstName = parts[0];
                            lastName = parts.slice(1).join(' ');
                        }

                        // Parse Company (Find match in our qualified list to restore context)
                        const scrapedCompany = item.orgName || item.companyName;
                        const companyDomain = item.companyDomain || item.orgWebsite;
                        const originalCompany = qualifiedCompanies.find(c =>
                            c.domain === companyDomain ||
                            (scrapedCompany && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
                        ) || {};

                        return {
                            first_name: firstName,
                            last_name: lastName,
                            email: item.email || item.workEmail || item.personalEmail,
                            title: item.position || item.title || item.jobTitle,
                            linkedin_url: item.linkedinUrl || item.linkedin_url || item.profileUrl,
                            company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                            company_domain: companyDomain || originalCompany.domain,
                            company_website: item.orgWebsite || originalCompany.website || '',
                            company_profile: originalCompany.company_profile || '',
                            city: item.city || item.location,
                            seniority: item.seniority
                        };
                    }).filter(l => l.email); // Only keep leads with email

                    logStep('Lead Finder', `Retrieved ${rawLeads.length} leads with emails.`);

                    // NEW: Group leads by company and apply per-company limits
                    const leadsByCompany = {};
                    for (const lead of rawLeads) {
                        const domain = lead.company_domain || lead.company_name;
                        if (!leadsByCompany[domain]) {
                            leadsByCompany[domain] = [];
                        }
                        leadsByCompany[domain].push(lead);
                    }

                    // Apply max leads per company and track totals
                    let companiesTracked = [];
                    for (const [domain, companyLeads] of Object.entries(leadsByCompany)) {
                        // Limit to maxLeadsPerCompany
                        const limitedLeads = companyLeads.slice(0, maxLeadsPerCompany);
                        allLeads.push(...limitedLeads);

                        // Track this company
                        const company = qualifiedCompanies.find(c => c.domain === domain || c.company_name === companyLeads[0].company_name);
                        if (company) {
                            companiesTracked.push({
                                name: company.company_name,
                                domain: company.domain || domain,
                                leadCount: limitedLeads.length,
                                metadata: {
                                    discovery_round: attempts,
                                    capital_role: company.capital_role,
                                    hq_city: company.hq_city,
                                    total_leads_found: companyLeads.length,
                                    leads_kept: limitedLeads.length
                                }
                            });
                        }

                        // Update lead distribution tracking
                        debugLog.leadDistribution[domain] = {
                            found: companyLeads.length,
                            kept: limitedLeads.length,
                            limited: companyLeads.length > maxLeadsPerCompany
                        };

                        logStep('Lead Finder', `${company?.company_name || domain}: ${limitedLeads.length}/${companyLeads.length} leads (${companyLeads.length > maxLeadsPerCompany ? 'limited' : 'all'})`);
                    }

                    // Track companies in database
                    if (companiesTracked.length > 0) {
                        try {
                            await markCompaniesAsResearched(userId, companiesTracked);
                            logStep('Database', `✅ Tracked ${companiesTracked.length} companies in database.`);
                        } catch (err) {
                            logStep('Database', `⚠️ Failed to track companies: ${err.message}`);
                        }
                    }

                    // Update total leads collected
                    totalLeadsCollected = allLeads.length;
                    logStep('Lead Finder', `📊 Total collected: ${totalLeadsCollected}/${targetLeads} leads from ${Object.keys(leadsByCompany).length} companies.`);

                } else {
                    logStep('Lead Finder', 'Scrape timed out or returned no dataset.');
                }

            } catch (err) {
                logStep('Lead Finder', `Scraping failed: ${err.message}`);
            }

            // RETRY MECHANISM: If 0 leads found, try again with relaxed filters
            if (allLeads.length === 0 && config.filters && !config.filters.fetchAll) {
                logStep('Lead Finder', '⚠️ strict search yielded 0 leads. Retrying with UNRESTRICTED search (fetching anyone)...');

                try {
                    // Force "fetchAll" mode = clears seniority, allows guessed emails
                    const relaxedFilters = { ...config.filters, fetchAll: true };
                    const runId2 = await startApifyScrape(process.env.APIFY_API_TOKEN, targetCompanies, relaxedFilters);
                    logStep('Lead Finder', `Retry Job started (ID: ${runId2})...`);

                    // Poll retry
                    let isComplete2 = false;
                    let datasetId2 = null;
                    let attempts2 = 0;
                    while (!isComplete2 && attempts2 < 600) { // Reuse same polling logic
                        await delay(5000);
                        const statusRes2 = await checkApifyRun(process.env.APIFY_API_TOKEN, runId2);
                        if (statusRes2.status === 'SUCCEEDED') { isComplete2 = true; datasetId2 = statusRes2.datasetId; }
                        else if (statusRes2.status === 'FAILED' || statusRes2.status === 'ABORTED') { throw new Error('Retry run failed'); }
                        attempts2++;
                    }

                    if (datasetId2) {
                        const rawItems2 = await getApifyResults(process.env.APIFY_API_TOKEN, datasetId2);
                        logStep('Lead Finder', `Retry complete. Retrieved ${rawItems2.length} raw leads.`);

                        // Map again with per-company logic
                        const retryRawLeads = rawItems2.map(item => {
                            let firstName = item.firstName || item.first_name || '';
                            let lastName = item.lastName || item.last_name || '';
                            if (!firstName && item.fullName) {
                                const parts = item.fullName.split(' ');
                                firstName = parts[0];
                                lastName = parts.slice(1).join(' ');
                            }
                            const scrapedCompany = item.orgName || item.companyName;
                            const companyDomain = item.companyDomain || item.orgWebsite;
                            const originalCompany = qualifiedCompanies.find(c =>
                                c.domain === companyDomain ||
                                (scrapedCompany && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
                            ) || {};

                            return {
                                first_name: firstName,
                                last_name: lastName,
                                email: item.email || item.workEmail || item.personalEmail,
                                title: item.position || item.title || item.jobTitle,
                                linkedin_url: item.linkedinUrl || item.linkedin_url || item.profileUrl,
                                company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                                company_domain: companyDomain || originalCompany.domain,
                                company_website: item.orgWebsite || originalCompany.website || '',
                                company_profile: originalCompany.company_profile || '',
                                city: item.city || item.location,
                                seniority: item.seniority
                            };
                        }).filter(l => l.email);

                        // Group and limit by company
                        const retryLeadsByCompany = {};
                        for (const lead of retryRawLeads) {
                            const domain = lead.company_domain || lead.company_name;
                            if (!retryLeadsByCompany[domain]) {
                                retryLeadsByCompany[domain] = [];
                            }
                            retryLeadsByCompany[domain].push(lead);
                        }

                        // Apply limits and tracking
                        let retryTracked = [];
                        for (const [domain, companyLeads] of Object.entries(retryLeadsByCompany)) {
                            const limitedLeads = companyLeads.slice(0, maxLeadsPerCompany);
                            allLeads.push(...limitedLeads);

                            const company = qualifiedCompanies.find(c => c.domain === domain || c.company_name === companyLeads[0].company_name);
                            if (company) {
                                retryTracked.push({
                                    name: company.company_name,
                                    domain: company.domain || domain,
                                    leadCount: limitedLeads.length,
                                    metadata: { retry: true, total_leads_found: companyLeads.length }
                                });
                            }
                        }

                        // Track retry companies
                        if (retryTracked.length > 0) {
                            try {
                                await markCompaniesAsResearched(userId, retryTracked);
                            } catch (err) {
                                logStep('Database', `⚠️ Retry tracking failed: ${err.message}`);
                            }
                        }

                        totalLeadsCollected = allLeads.length;
                        logStep('Lead Finder', `Retry success! Found ${totalLeadsCollected} total leads.`);

                    }

                } catch (retryErr) {
                    logStep('Lead Finder', `Retry failed: ${retryErr.message}`);
                }
            }
        }

        const leadCount = allLeads.length;
        logStep('Lead Finder', `Total: Found ${leadCount} enriched leads.`);

        // 4. Outreach Creator
        logStep('Outreach Creator', 'Drafting personalized messages...');
        const outreachInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ leads: allLeads }) }] }];

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
                    `INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, custom_data, source)
                     VALUES ($1, $2, $3, $4, $5, 'NEW', $6, 'Automation')`,
                    [
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
        { role: "user", content: [{ type: "input_text", text: "Enrich this person with phone numbers." }] }
    ]);

    return result.finalOutput?.phone_numbers || [];
};
