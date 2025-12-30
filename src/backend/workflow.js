import { fileSearchTool, hostedMcpTool, Agent, Runner, withTrace, tool } from "@openai/agents";
import { startApifyScrape, checkApifyRun, getApifyResults, performGoogleSearch } from "./services/apify.js"; // Import performGoogleSearch
import { z } from "zod";
import { query } from "../../db/index.js";
import {
    getExcludedDomains,
    getExcludedCompanyNames,
    getCompanyStats
} from "./company-tracker.js";
import { LeadScraperService } from "./services/lead-scraper-service.js";
import { WORKFLOW_CONFIG, getEffectiveMaxLeads, AGENT_MODELS } from "../config/workflow.js";
import { CostTracker } from "./services/cost-tracker.js";

// --- Schema Definitions ---
const CompanyFinderSchema = z.object({
    results: z.array(z.object({
        company_name: z.string(),
        domain: z.string(),
        description: z.string().optional()
    }))
});

const CompanyProfilerSchema = z.object({
    results: z.array(z.object({
        company_name: z.string(),
        domain: z.string(),
        company_profile: z.string(),
        match_score: z.number().min(0).max(10).describe("Relevance score 0-10")
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
        company_profile: z.string(),
        match_score: z.number().min(1).max(10).optional()
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

// Refiner Schema
const FilterRefinerSchema = z.object({
    job_titles: z.array(z.string()).describe("Specific job titles to search for"),
    excluded_keywords: z.array(z.string()).describe("Keywords to exclude from titles (e.g. 'assistant', 'intern')"),
    seniority: z.array(z.string()).describe("Seniority levels (e.g. 'owner', 'partner', 'cxo', 'vp')")
});

// --- Helper Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getToolsForAgent = (agentName) => {
    const apolloMcp = hostedMcpTool({
        serverLabel: "Apollo_Lead_Finder",
        serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01",
        authorization: "apollo-mcp-client-key-01"
    });

    // CUSTOM TOOL: Google Search via Apify
    const googleSearchTool = tool({
        name: 'web_search',
        description: 'Search the web for companies, verification, or information using Google.',
        parameters: z.object({
            query: z.string().describe('The search query string.')
        }),
        execute: async ({ query }) => {
            console.log(`[GoogleSearch] Searching for: "${query}"`);
            const token = process.env.APIFY_API_TOKEN;
            if (!token) throw new Error("Missing APIFY_API_TOKEN");
            const results = await performGoogleSearch(query, token);
            return JSON.stringify(results.slice(0, 10)); // Increased to 10 results for better context
        }
    });

    if (agentName === 'company_finder') return [googleSearchTool];
    if (agentName === 'company_profiler') return [googleSearchTool];
    if (agentName === 'apollo_lead_finder') return [apolloMcp];
    if (agentName === 'outreach_creator') return [];
    return [];
};

/**
 * Main Workflow Execution
 */
export const runAgentWorkflow = async (input, config) => {
    let {
        agentConfigs = {},
        listeners,
        userId,
        targetLeads = 50,
        maxLeadsPerCompany = 3,
        minBatchSize = 5,
        maxDiscoveryAttempts = 5,
        filters = {}, // Default empty
        idempotencyKey = null,
        icpId
    } = config;

    if (!userId) throw new Error('userId is required');

    const logStep = (step, detail) => {
        if (listeners?.onLog) listeners.onLog({ step, detail });
        else console.log(`[${step}] ${detail}`);
    };

    // --- Testing Limits ---
    const effectiveMaxLeads = getEffectiveMaxLeads();
    if (WORKFLOW_CONFIG.IS_TESTING && targetLeads > effectiveMaxLeads) {
        logStep('System', `🧪 Testing Mode: Capping target to ${effectiveMaxLeads}`);
        targetLeads = effectiveMaxLeads;
    }

    // --- Dynamic Context Injection ---
    let companyContext = { name: "The User's Company", goal: "Expand client base.", baselineTitles: [] };
    if (icpId) {
        try {
            const icpRes = await query(`SELECT config FROM icps WHERE id = $1`, [icpId]);
            if (icpRes.rows.length > 0 && icpRes.rows[0].config) {
                const cfg = icpRes.rows[0].config;
                if (cfg.companyName) companyContext.name = cfg.companyName;
                if (cfg.userName) companyContext.goal = `${cfg.userName}'s Goal: ${companyContext.goal}`;
                // Capture baseline titles from ICP to prevent hallucinations
                if (cfg.jobTitles && Array.isArray(cfg.jobTitles)) {
                    companyContext.baselineTitles = cfg.jobTitles;
                }
            }
        } catch (e) { console.warn("Context fetch failed", e); }
    }

    // --- Dual-Loop Learning ---
    let leadLearning = { pass: "", reject: "" };
    try {
        const [passRows, rejectRows] = await Promise.all([
            query(`SELECT reason FROM lead_feedback WHERE user_id = $1 AND new_status = 'NEW' ORDER BY created_at DESC LIMIT 5`, [userId]),
            query(`SELECT reason FROM lead_feedback WHERE user_id = $1 AND new_status = 'DISQUALIFIED' ORDER BY created_at DESC LIMIT 5`, [userId])
        ]);
        if (passRows.rows.length > 0) leadLearning.pass = "Likes: " + passRows.rows.map(r => r.reason).join(", ");
        if (rejectRows.rows.length > 0) leadLearning.reject = "Avoid: " + rejectRows.rows.map(r => r.reason).join(", ");
    } catch (e) { console.warn("Learning loop failed", e); }

    const runner = new Runner();
    const costTracker = new CostTracker(`wf_${Date.now()}`);

    // --- OPTIMIZATION 1: LLM Filter Refiner ---
    logStep('System', '🧠 Refining scraper filters based on user request...');
    try {
        const refinerAgent = new Agent({
            name: "Filter Refiner",
            instructions: `Extract tactical lead filters. 
            BASELINE TITLES (from User Onboarding): ${companyContext.baselineTitles.join(', ') || 'None selected'}
            - If baseline titles exist, use them as the primary list.
            - Only add new titles if they are strictly missing and highly relevant to the goal: ${companyContext.goal}
            Constraints: Be precise. Exclude 'intern', 'assistant' unless requested.
            Input: "${input.input_as_text}"`,
            model: "gpt-4o-mini", // Keep mini for this simple logic task
            outputType: FilterRefinerSchema
        });

        const refinement = await runner.run(refinerAgent, [{ role: "user", content: "Generate filters." }]);
        const AI_Filters = refinement.finalOutput || {};

        // Merge AI filters with existing ones (User overrides take precedence if strict, but here we append)
        if (AI_Filters.job_titles?.length) {
            filters.job_titles = [...(filters.job_titles || []), ...AI_Filters.job_titles];
            logStep('Filter Refiner', `➕ Added Job Titles: ${AI_Filters.job_titles.join(', ')}`);
        }
        if (AI_Filters.excluded_keywords?.length) {
            filters.excluded_functions = [...(filters.excluded_functions || []), ...AI_Filters.excluded_keywords];
            logStep('Filter Refiner', `⛔ Added Exclusions: ${AI_Filters.excluded_keywords.join(', ')}`);
        }
        if (AI_Filters.seniority?.length) {
            filters.seniority = [...(filters.seniority || []), ...AI_Filters.seniority];
        }
    } catch (e) {
        logStep('Filter Refiner', `⚠️ Refinement skipped: ${e.message}`);
    }

    // --- Agent Definitions ---
    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: `Hunter for ${companyContext.name}. Find 20+ companies for: ${input.input_as_text}. PASS: ${leadLearning.pass}. AVOID: ${leadLearning.reject}. USES: web_search tool.`,
        model: AGENT_MODELS.company_finder,
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // OPTIMIZATION 3: Updated Profiler Inst to ask for Score
    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: `Evaluator. Visit domains using 'web_search' to verify match for: ${companyContext.goal}. 
        Assign 'match_score' (0-10).
        CRITICAL: 
        - Score < 4: Mismatch / Fake.
        - Score > 7: Strong Match.
        Reject parked domains (Score 0).`,
        model: AGENT_MODELS.company_profiler,
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    const apolloLeadFinder = new Agent({
        name: "Apollo Lead Finder",
        instructions: `Headhunter. Goal: ${companyContext.goal}. Assign match_score (1-10) to each lead. PASS: ${leadLearning.pass}. REJECT: ${leadLearning.reject}.`,
        model: AGENT_MODELS.apollo_lead_finder,
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: `Draft outreach for ${companyContext.name}.`,
        model: AGENT_MODELS.outreach_creator,
        tools: [],
        outputType: OutreachCreatorSchema,
    });

    // --- Main Workflow Loop ---
    let globalLeads = [];
    let scrapedNamesSet = new Set();
    const excludedNames = await getExcludedCompanyNames(userId);
    const leadScraper = new LeadScraperService();
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    while (globalLeads.length < targetLeads && attempts < MAX_ATTEMPTS) {
        attempts++;
        logStep('Workflow', `Round ${attempts}: Need ${targetLeads - globalLeads.length} more.`);

        // 1. Discovery
        let candidates = [];
        try {
            const finderRes = await runner.run(companyFinder, [{ role: "user", content: `Find companies for: ${input.input_as_text}. Avoid: ${[...scrapedNamesSet, ...excludedNames].slice(0, 30).join(', ')}` }], { maxTurns: 20 });
            candidates = (finderRes.finalOutput?.results || []).filter(c => !scrapedNamesSet.has(c.company_name));
        } catch (e) { logStep('Company Finder', `Failed: ${e.message}`); }

        if (candidates.length === 0) break;

        // 2. Profiling & Filtering
        let validCandidates = [];
        try {
            logStep('Company Profiler', `Analyzing ${candidates.length} candidates...`);
            const profilerRes = await runner.run(companyProfiler, [{ role: "user", content: JSON.stringify(candidates) }], { maxTurns: 20 });
            const profiled = profilerRes.finalOutput?.results || [];

            // OPTIMIZATION 3: Confidence Threshold
            validCandidates = profiled.filter(c => {
                const isHighQuality = (c.match_score || 0) >= 7;
                if (!isHighQuality) logStep('Profiler', `🗑️ Dropped ${c.company_name} (Score: ${c.match_score}/10)`);
                return isHighQuality;
            });
            logStep('Company Profiler', `✅ ${validCandidates.length}/${candidates.length} Qualified (Score >= 7).`);
        } catch (e) {
            logStep('Company Profiler', `Failed: ${e.message}. Fallback to all candidates.`);
            validCandidates = candidates;
        }

        if (validCandidates.length === 0) continue;

        // 3. Sequential Scraping (Short-Circuit)
        // OPTIMIZATION 2: Process in small batches to save budget
        const SCRAPE_BATCH_SIZE = 3;
        for (let i = 0; i < validCandidates.length; i += SCRAPE_BATCH_SIZE) {
            // STOP condition
            if (globalLeads.length >= targetLeads) {
                logStep('Optimization', `✅ Target met (${globalLeads.length}/${targetLeads}). Stopping scrape early.`);
                break;
            }

            const batch = validCandidates.slice(i, i + SCRAPE_BATCH_SIZE);
            logStep('Lead Finder', `Scraping batch of ${batch.length} companies...`);

            try {
                const leads = await leadScraper.fetchLeads(batch, filters, logStep);
                if (leads.length > 0) {
                    const rankRes = await runner.run(apolloLeadFinder, [{ role: "user", content: `Rank these leads (Match 1-10) for ${companyContext.goal}: ${JSON.stringify(leads.slice(0, 30))}` }]);
                    const ranked = rankRes.finalOutput?.leads || leads;
                    const sorted = ranked.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

                    const perCompany = {};
                    sorted.forEach(l => {
                        if (!perCompany[l.company_name]) perCompany[l.company_name] = [];
                        if (perCompany[l.company_name].length < maxLeadsPerCompany) perCompany[l.company_name].push(l);
                    });

                    const added = Object.values(perCompany).flat();
                    globalLeads.push(...added);
                    logStep('Workflow', `+${added.length} leads. Total: ${globalLeads.length}/${targetLeads}`);
                }

                // Mark processed
                batch.forEach(c => scrapedNamesSet.add(c.company_name));

            } catch (e) { logStep('Lead Finder', `Batch failed: ${e.message}`); }
        }
    }

    // --- Outreach Generation ---
    logStep('Outreach Creator', `Drafting messages for ${globalLeads.length} leads...`);
    let finalLeads = [];
    try {
        const outreachRes = await runner.run(outreachCreator, [{ role: "user", content: JSON.stringify(globalLeads.slice(0, 20)) }]);
        finalLeads = outreachRes.finalOutput?.leads || globalLeads;
    } catch (e) { logStep('Outreach Creator', `Failed: ${e.message}`); finalLeads = globalLeads; }

    // --- Save to CRM ---
    await saveLeadsToDB(finalLeads, userId, icpId, logStep);

    return {
        status: globalLeads.length >= targetLeads ? 'success' : 'partial',
        leads: finalLeads,
        stats: { total: globalLeads.length, attempts }
    };
};

/**
 * DB Persistence
 */
const saveLeadsToDB = async (leads, userId, icpId, logStep) => {
    if (!leads || leads.length === 0) return;
    let count = 0;
    for (const lead of leads) {
        try {
            const exists = await query("SELECT id FROM leads WHERE email = $1 AND user_id = $2", [lead.email, userId]);
            if (exists.rows.length > 0) continue;

            await query(`INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, source, user_id, custom_data) 
                         VALUES ($1, $2, $3, $4, $5, 'NEW', 'Outbound Agent', $6, $7)`,
                [lead.company_name, `${lead.first_name} ${lead.last_name}`, lead.email, lead.title, lead.linkedin_url, userId, { icp_id: icpId, score: lead.match_score, profile: lead.company_profile }]);
            count++;
        } catch (e) { console.error("Save error", e); }
    }
    logStep('CRM', `Saved ${count} new leads to database.`);
};

/**
 * Manual Enrichment (Helper)
 */
export const enrichLeadWithPhone = async (lead) => {
    return [];
};
