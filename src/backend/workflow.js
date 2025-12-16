import { fileSearchTool, hostedMcpTool, webSearchTool, Agent, Runner, withTrace } from "@openai/agents";
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
    // Assuming 'apollo' is the configured name in the MCP runner/server
    const apolloMcp = hostedMcpTool({
        connectorId: "apollo", // The ID linking to the hosted integration
        serverLabel: "Apollo Lead Finder"
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
    const finderInst = agentPrompts['company_finder'] || `You are the "Hunter" Agent for Fifth Avenue Properties... (Default)`;
    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: finderInst,
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
        instructions: leadInst,
        model: "gpt-4o-mini", // Cost efficient
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

            // Construct prompt for this iteration
            let currentPrompt = originalPrompt;
            currentPrompt += `\n\n[SYSTEM INJECTION]: You are in iteration ${attempts}. Your GOAL is to find exactly ${needed} NEW companies.`;

            // Smart Retry Logic for 0 results
            if (attempts > 1 && lastRoundFound === 0) {
                currentPrompt += `\n\n[ADAPTATION]: Your previous search yielded 0 results. You MUST use different, broader search terms now.`;
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

        // 3. Lead Finder
        logStep('Apollo Lead Finder', 'Finding decision makers (Reliability Mode)...');

        let allLeads = [];
        const BATCH_SIZE = 3;

        const companiesWithDomains = qualifiedCompanies.map(c => {
            let domain = c.domain;
            if ((!domain || !domain.includes('.')) && c.website) {
                try {
                    const url = new URL(c.website.startsWith('http') ? c.website : `https://${c.website}`);
                    domain = url.hostname.replace('www.', '');
                } catch (e) { /* ignore */ }
            }
            return { ...c, domain };
        }).filter(c => c.domain && c.domain.includes('.'));

        if (companiesWithDomains.length < qualifiedCompanies.length) {
            logStep('Apollo Lead Finder', `Warning: ${qualifiedCompanies.length - companiesWithDomains.length} companies excluded due to missing/invalid domains.`);
        }
        logStep('Apollo Lead Finder', `Processing ${companiesWithDomains.length} companies for leads.`);

        for (let i = 0; i < companiesWithDomains.length; i += BATCH_SIZE) {
            const batch = companiesWithDomains.slice(i, i + BATCH_SIZE);
            logStep('Apollo Lead Finder', `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(companiesWithDomains.length / BATCH_SIZE)} (${batch.length} companies)...`);

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
