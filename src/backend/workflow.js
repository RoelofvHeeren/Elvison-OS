import { fileSearchTool, hostedMcpTool, webSearchTool, Agent, Runner, withTrace } from "@openai/agents";
import { startApifyScrape, checkApifyRun, getApifyResults } from "./services/apify.js";
import { z } from "zod";
import { query } from "../../db/index.js";

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

const retryWithBackoff = async (fn, retries = 3, baseDelay = 1000) => {
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

// --- Dynamic Workflow Function ---
/**
 * Runs the agent workflow with dynamic vector store inputs.
 * @param {Object} input - Workflow input { input_as_text: string }
 * @param {Object} config - Configuration { vectorStoreId: string, agentConfigs: Object }
 */
export const runAgentWorkflow = async (input, config) => {
    let { vectorStoreId, agentConfigs = {}, listeners } = config;

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

        // 3. Attach matching tools
        if (enabledIds.includes('apollo_mcp')) {
            tools.push(apolloMcp);
        }
        if (enabledIds.includes('web_search')) {
            tools.push(webSearch);
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

        // 0. Parse Target Count
        let targetCount = 20; // Default per user request
        const countMatch = input.input_as_text.match(/\b(\d+)\b/);
        if (countMatch) {
            targetCount = parseInt(countMatch[1], 10);
        }
        // Enforce Hard Limit
        if (targetCount > 50) {
            targetCount = 50;
            logStep('Workflow', 'Target count capped at 50 companies (System Limit).');
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

            // Phased Search Strategy Construction
            let strategyInstruction = "";
            switch (attempts) {
                case 1:
                    strategyInstruction = `PHASE 1 (DIRECT): Search for "Residential real estate investment firm Canada" and "Real estate investment firm [City]". Check search results pages 1-3. Focus on pure equity firms.`;
                    break;
                case 2:
                    strategyInstruction = `PHASE 2 (BROADER): Switch terms to "Real estate family office Canada", "Private Real Estate Equity Canada". Check pages 1-3.`;
                    break;
                case 3:
                    strategyInstruction = `PHASE 3 (LISTS): Search for "Top 100 real estate investment firms Canada", "List of family offices Toronto". OPEN the list articles and extract names.`;
                    break;
                default:
                    strategyInstruction = `PHASE 4 (DEEP SEARCH): Go back to broad keywords but dig deeper (Page 4, 5, 6). Look for specific niche firms missed earlier.`;
                    break;
            }

            // Construct prompt for this iteration
            let currentPrompt = originalPrompt;
            currentPrompt += `\n\n[SYSTEM INJECTION]: You are in iteration ${attempts}. Your GOAL is to find exactly ${needed} NEW companies.`;
            currentPrompt += `\n\n[STRATEGY]: ${strategyInstruction}`;

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
            lastRoundFound = finderResults.length;
            debugLog.discovery.push({ round: attempts, results: finderResults });

            if (finderResults.length === 0) {
                logStep('Company Finder', 'No new companies found in this search.');
                if (attempts >= MAX_ATTEMPTS) break;
                continue;
            }

            logStep('Company Finder', `Found ${finderResults.length} candidates. Profiling...`);

            // 2. Profiler
            const profilerInput = [{ role: "user", content: [{ type: "input_text", text: JSON.stringify({ results: finderResults }) }] }];
            const profilerRes = await retryWithBackoff(() => runner.run(companyProfiler, profilerInput));

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
                        qualifiedInBatch.push(merged);
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

        // Extract domains from qualified companies
        const targetDomains = qualifiedCompanies
            .map(c => {
                let domain = c.domain;
                if ((!domain || !domain.includes('.')) && c.website) {
                    try {
                        const url = new URL(c.website.startsWith('http') ? c.website : `https://${c.website}`);
                        domain = url.hostname.replace('www.', '');
                    } catch (e) { /* ignore */ }
                }
                return domain;
            })
            .filter(d => d && d.includes('.'));

        if (targetDomains.length === 0) {
            console.warn("No valid domains found for scraping.");
        } else {
            logStep('Lead Finder', `Starting scrape for ${targetDomains.length} domains...`);

            try {
                // Trigger Apify Run
                // Use system token (or user provided if we passed it down, but here we assume system flow or env)
                // We use filters passed from the frontend (via config) or fall back to defaults in startApifyScrape
                const runId = await startApifyScrape(process.env.APIFY_API_TOKEN, targetDomains, config.filters || {});
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
                    allLeads = rawItems.map(item => {
                        // Parse Name
                        let firstName = item.firstName || item.first_name || '';
                        let lastName = item.lastName || item.last_name || '';
                        if (!firstName && item.fullName) {
                            const parts = item.fullName.split(' ');
                            firstName = parts[0];
                            lastName = parts.slice(1).join(' ');
                        }

                        // Parse Company (Find match in our qualified list to restore context)
                        // PipelineLabs returns 'orgName' or 'companyName'.
                        const scrapedCompany = item.orgName || item.companyName;
                        // Attempt to match back to our Qualified List for 'company_profile' and 'company_website' context
                        const originalCompany = qualifiedCompanies.find(c =>
                            c.domain === item.companyDomain ||
                            (scrapedCompany && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
                        ) || {};

                        return {
                            first_name: firstName,
                            last_name: lastName,
                            email: item.email || item.workEmail || item.personalEmail,
                            title: item.position || item.title || item.jobTitle,
                            linkedin_url: item.linkedinUrl || item.linkedin_url || item.profileUrl,
                            company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                            company_website: item.orgWebsite || originalCompany.website || '',
                            company_profile: originalCompany.company_profile || '',
                            // Add extra context for outreach
                            city: item.city || item.location,
                            seniority: item.seniority
                        };
                    }).filter(l => l.email); // Only keep leads with email

                    logStep('Lead Finder', `Valid leads after filtering: ${allLeads.length}`);

                } else {
                    logStep('Lead Finder', 'Scrape timed out or returned no dataset.');
                }

            } catch (err) {
                logStep('Lead Finder', `Scraping failed: ${err.message}`);
                // Don't crash entire workflow, proceed 0 leads to see if we can debug
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
