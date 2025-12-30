import { fileSearchTool, hostedMcpTool, Agent, Runner, withTrace, tool } from "@openai/agents";
import { startApifyScrape, checkApifyRun, getApifyResults, performGoogleSearch, scrapeCompanyWebsite } from "./services/apify.js"; // Import performGoogleSearch and scrapeCompanyWebsite
import { GeminiModel } from "./services/gemini.js"; // Import GeminiModel
import { ClaudeModel } from "./services/claude.js"; // Import ClaudeModel
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

// Architect Schema for normalization
const DataArchitectSchema = z.object({
    leads: z.array(z.object({
        first_name: z.string(),
        last_name: z.string(),
        company_name: z.string(),
        title: z.string(),
        email: z.string(),
        linkedin_url: z.string(),
        company_website: z.string(),
        is_valid: z.boolean()
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
    const apifyToken = process.env.APIFY_API_TOKEN;

    if (agentName === 'company_finder') {
        return [
            tool({
                name: "google_search_and_extract",
                description: "Search using Google and return organic results (Title, URL, Snippet).",
                parameters: z.object({ query: z.string() }),
                execute: async ({ query }) => {
                    const results = await performGoogleSearch(query, apifyToken);
                    return results.map(r => `NAME: ${r.title}\nURL: ${r.link}\nDESC: ${r.snippet}`).join('\n\n');
                }
            })
        ];
    }

    if (agentName === 'company_profiler') {
        return [
            tool({
                name: "scrape_company_website",
                description: "Deep research: Scrape home, about, services, and pricing pages for a domain.",
                parameters: z.object({ domain: z.string() }),
                execute: async ({ domain }) => {
                    return await scrapeCompanyWebsite(domain, apifyToken);
                }
            })
        ];
    }

    if (agentName === 'apollo_lead_finder') {
        return [
            hostedMcpTool({
                serverLabel: "Apollo_Lead_Finder",
                serverUrl: "https://apollo-mcp-v4-production.up.railway.app/sse?apiKey=apollo-mcp-client-key-01",
                authorization: "apollo-mcp-client-key-01"
            })
        ];
    }

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
            instructions: `GOAL: Extract tactical lead filters. 
            BASELINE TITLES (from User Onboarding): ${companyContext.baselineTitles.join(', ') || 'None selected'}
            - If baseline titles exist, use them as the primary list.
            - Only add new titles if they are strictly missing and highly relevant to the goal: ${companyContext.goal}
            Constraints: Be precise. Exclude 'intern', 'assistant' unless requested.
            Input: "${input.input_as_text}"`,
            model: AGENT_MODELS.default, // Using Gemini 1.5 Flash as default (cheaper, safe)
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

    // --- Model Initialization ---
    const googleKey = process.env.GOOGLE_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    // 5-Agent Model Assignments
    const finderModel = googleKey ? new GeminiModel(googleKey, 'gemini-1.5-flash') : AGENT_MODELS.company_finder;
    const profilerModel = anthropicKey ? new ClaudeModel(anthropicKey, 'claude-3-5-sonnet-20240620') : AGENT_MODELS.company_profiler;
    const apolloModel = AGENT_MODELS.apollo_lead_finder; // gpt-4-turbo
    const outreachModel = googleKey ? new GeminiModel(googleKey, 'gemini-1.5-flash') : AGENT_MODELS.outreach_creator;
    const architectModel = anthropicKey ? new ClaudeModel(anthropicKey, 'claude-3-5-sonnet-20240620') : AGENT_MODELS.data_architect;

    // --- Agent Definitions ---

    // 1. Company Finder: Gemini 1.5 Flash
    const companyFinder = new Agent({
        name: "Company Finder",
        instructions: `GOAL: Discover real companies via Google search.
PROTOCOL: Use google_search_and_extract to find organic results.
STRICTURE: Extract ONLY: Company name, Primary domain, One-line description. 
REJECT: Ambiguous or directory-style results (LinkedIn, Yelp, etc).
CONTEXT: ${input.input_as_text}. PASS: ${leadLearning.pass}.`,
        model: finderModel,
        tools: getToolsForAgent('company_finder'),
        outputType: CompanyFinderSchema,
    });

    // 2. Company Profiler: Claude 3.5 Sonnet
    const companyProfiler = new Agent({
        name: "Company Profiler",
        instructions: `GOAL: Deep research and business inference. 
PROTOCOL: Use 'scrape_company_website' for each domain.
STRICTURE: Output a strict structured profile:
- Core offer: What do they sell?
- Target customer: Who do they sell to?
- Industry: Category.
- Company size estimate: Size based on web evidence.
- Buying signals: Expansion, hiring, pain points.
NO creative writing. NO outreach content.
Assign 'match_score' (1-10) against goal: ${companyContext.goal}.`,
        model: profilerModel,
        tools: getToolsForAgent('company_profiler'),
        outputType: CompanyProfilerSchema,
    });

    // 3. Apollo (Lead Finder): GPT-4 Turbo
    const apolloLeadFinder = new Agent({
        name: "Apollo Agent",
        instructions: `GOAL: Generate precise Apollo filters only. 
PROTOCOL: Take domain + company profile. Generate filters for contacts.
STRICTURE: Use GPT-4 Turbo logic to be reliable. Do NOT improvise filters.
CONTEXT: Goal for ${companyContext.name} is ${companyContext.goal}. Match these types: ${icpTitles.join(', ')}.`,
        model: apolloModel,
        tools: getToolsForAgent('apollo_lead_finder'),
        outputType: ApolloLeadFinderSchema,
    });

    // 4. Outreach Creator: Gemini 1.5 Flash
    const outreachCreator = new Agent({
        name: "Outreach Creator",
        instructions: `GOAL: Generate personalized outreach.
PROTOCOL: Use strict message templates. Inject personalization fields only. 
STRICTURE: No decision-making. No research. No tone exploration.`,
        model: outreachModel,
        tools: [],
        outputType: OutreachCreatorSchema,
    });

    // 5. Data Architect: Claude 3.5 Sonnet (Fallback)
    const dataArchitect = new Agent({
        name: "Data Architect",
        instructions: `GOAL: Normalize, validate, and store data.
PROTOCOL: Use strict schema. Normalize names (CapitalCase), fix broken URLs, and validate emails.
STRICTURE: LLM is fallback only. Zero creativity. If data is unsalvageable, mark is_valid: false.`,
        model: architectModel,
        outputType: DataArchitectSchema,
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
                // 4. Data Architect: Validation & Normalization
                if (leads.length > 0) {
                    logStep('Data Architect', `Normalizing ${leads.length} leads...`);
                    // Deterministic normalization
                    const deterministicLeads = leads.filter(l => l.first_name && l.last_name && l.email);

                    // Fallback to Claude only for ambiguous records
                    const ambiguousLeads = leads.filter(l => !l.first_name || !l.last_name || !l.email);
                    let fixedLeads = [];
                    if (ambiguousLeads.length > 0) {
                        const architectRes = await runner.run(dataArchitect, [{ role: "user", content: `Normalize these ambiguous leads: ${JSON.stringify(ambiguousLeads)}` }]);
                        fixedLeads = (architectRes.finalOutput?.leads || []).filter(l => l.is_valid);
                    }

                    const validatedLeads = [...deterministicLeads, ...fixedLeads];

                    // Proceed with ranking on validated data
                    if (validatedLeads.length > 0) {
                        const rankRes = await runner.run(apolloLeadFinder, [{ role: "user", content: `Rank these leads (Match 1-10) for ${companyContext.goal}: ${JSON.stringify(validatedLeads.slice(0, 30))}` }]);
                        const ranked = rankRes.finalOutput?.leads || validatedLeads;
                        // ... rest of logic uses ranked ...
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
