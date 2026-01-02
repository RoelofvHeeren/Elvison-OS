import { fileSearchTool, hostedMcpTool, Agent, Runner, withTrace, tool } from "@openai/agents";
import { checkApifyRun, getApifyResults, performGoogleSearch, scrapeCompanyWebsite, scanSiteStructure, scrapeSpecificPages } from "./services/apify.js"; // Import dynamic tools
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
import { CostTracker, runAgentWithTracking } from "./services/cost-tracker.js";
import { enforceAgentContract } from "./utils/agent-contract.js"; // Import contract enforcer

// --- Schema Definitions ---
const CompanyFinderSchema = z.object({
    results: z.array(z.object({
        companyName: z.string(),
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


// --- Moved inside runAgentWorkflow for context access ---

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

    // --- Safety & Cost Controls ---
    const effectiveMaxLeads = getEffectiveMaxLeads();
    if (WORKFLOW_CONFIG.IS_TESTING && targetLeads > effectiveMaxLeads) {
        logStep('System', `🧪 Testing Mode: Capping target to ${effectiveMaxLeads}`);
        targetLeads = effectiveMaxLeads;
    }

    const checkCancellation = async () => {
        try {
            const res = await query(`SELECT status FROM workflow_runs WHERE id = $1`, [idempotencyKey || runId]);
            if (res.rows.length > 0 && res.rows[0].status === 'CANCELLED') {
                logStep('System', '⛔ Run Cancellation Detected. Stopping workflow immediately.');
                return true;
            }
        } catch (e) {
            console.error("Cancellation check failed", e);
        }
        return false;
    };

    const getToolsForAgent = (agentName) => {
        const apifyToken = process.env.APIFY_API_TOKEN;

        if (agentName === 'company_finder') {
            return [
                tool({
                    name: "google_search_and_extract",
                    description: "Search using Google and return organic results (Title, URL, Snippet).",
                    parameters: z.object({ query: z.string() }),
                    execute: async ({ query }) => {
                        const results = await performGoogleSearch(query, apifyToken, checkCancellation);
                        return results.map(r => `NAME: ${r.title}\nURL: ${r.link}\nDESC: ${r.snippet}`).join('\n\n');
                    }
                })
            ];
        }

        if (agentName === 'company_profiler') {
            return [
                tool({
                    name: "scan_site_structure",
                    description: "Step 1: Scan homepage/sitemap to discover available pages/links.",
                    parameters: z.object({ domain: z.string() }),
                    execute: async ({ domain }) => {
                        return await scanSiteStructure(domain, apifyToken, checkCancellation);
                    }
                }),
                tool({
                    name: "scrape_specific_pages",
                    description: "Step 2: Scrape valid URLs found in the scan step.",
                    parameters: z.object({ urls: z.array(z.string()) }),
                    execute: async ({ urls }) => {
                        return await scrapeSpecificPages(urls, apifyToken, checkCancellation);
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
                if (cfg.surveys && cfg.surveys.company_profiler && cfg.surveys.company_profiler.manual_research) {
                    companyContext.manualResearch = cfg.surveys.company_profiler.manual_research;
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

    // --- Model Initialization & Hardening ---
    const rawGoogleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const rawAnthropicKey = process.env.ANTHROPIC_API_KEY;

    // Sanitize and validate keys (Removing all whitespace/newlines)
    const googleKey = (typeof rawGoogleKey === 'string' && rawGoogleKey.length > 10) ? rawGoogleKey.trim().replace(/[\s\r\n\t]/g, '') : null;
    const anthropicKey = (typeof rawAnthropicKey === 'string' && rawAnthropicKey.length > 10) ? rawAnthropicKey.trim().replace(/[\s\r\n\t]/g, '') : null;

    if (googleKey) {
        logStep('System', `🔑 Google Key: ${googleKey.substring(0, 7)}...${googleKey.substring(googleKey.length - 4)} (Len: ${googleKey.length})`);
    } else if (rawGoogleKey) {
        logStep('System', `⚠️ Warning: GOOGLE_API_KEY looks invalid (Type: ${typeof rawGoogleKey}, Len: ${rawGoogleKey?.length}).`);
    }

    if (anthropicKey) {
        logStep('System', `🔑 Anthropic Key detected: ${anthropicKey.substring(0, 7)}...`);
    }

    // --- STRICT Model Initialization (No Silent Fallbacks) ---
    if (!googleKey) logStep('System', '⚠️ Missing Google API Key. Discovery/Gemini agents will fail.');
    if (!anthropicKey) logStep('System', '⚠️ Missing Anthropic API Key. Profiler/Claude agents will fail.');

    const finderModel = new GeminiModel(googleKey, 'gemini-2.0-flash');
    const profilerModel = new ClaudeModel(anthropicKey, 'claude-3-5-sonnet-20240620');

    const getSafeModel = (type) => {
        if (type === 'discovery' || type === 'outreach' || type === 'refiner') {
            return finderModel;
        }
        if (type === 'profiler' || type === 'architect') {
            return profilerModel;
        }
        return 'gpt-4-turbo'; // For Apollo/defaults if needed
    };

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
            model: getSafeModel('refiner'),
            model: getSafeModel('refiner')
            // outputType removed to prevent premature validation
        });

        const refinement = await runAgentWithTracking(runner, refinerAgent, [{ role: "user", content: "Generate filters." }], costTracker);

        // HARD CONTRACT ENFORCEMENT
        const AI_Filters = enforceAgentContract({
            agentName: "Filter Refiner",
            rawOutput: refinement.finalOutput, // Pass the output directly
            schema: FilterRefinerSchema
        });

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
        if (e.message?.includes("API key not valid") || e.message?.includes("400") || e.message?.includes("401")) {
            logStep('Filter Refiner', `❌ Gemini/Anthropic Key Rejected. Stopping run to save costs.`);
            throw new Error(`Authentication Error: ${e.message}`);
        } else {
            logStep('Filter Refiner', `⚠️ Refinement skipped: ${e.message}`);
        }
    }

    // --- Agent Definitions with Dynamic Models ---
    const getFinderAgent = () => new Agent({
        name: "Company Finder",
        instructions: `GOAL: Discover real companies via Google search.
PROTOCOL: Use google_search_and_extract to find organic results.
STRATEGY: 
1. If a result is a direct company homepage, extract it.
2. If a result is a LIST/DIRECTORY (e.g. "Top 10..."), READ THE SNIPPET. Extract company names mentioned in the snippet.
3. INFER domains for well-known companies found in snippets if missing (e.g. "Toast" -> "toast.tab.com" or "toast.com").
STRICTURE: Extract: Company name, Primary domain (best guess permitted), One-line description. 
REJECT: The Directory itself (e.g. do not output "Yelp" as the company), but extracting companies FROM Yelp is okay.
CONTEXT: ${input.input_as_text}. PASS: ${leadLearning.pass}.`,
        model: getSafeModel('discovery'),
        model: getSafeModel('discovery'),
        tools: getToolsForAgent('company_finder')
        // outputType removed to prevent premature validation
    });

    const getProfilerAgent = () => new Agent({
        name: "Company Profiler",
        instructions: `GOAL: Deep research and business inference. 
PROTOCOL:
1. Call 'scan_site_structure(domain)' to see available links.
2. REASON: Compare links against manual instructions. Select 3-5 most relevant URLs (e.g. portfolio, projects, team).
3. Call 'scrape_specific_pages([urls])' to get deep content.
4. Output strict profile based on ALL gathered data.

STRICTURE: Output a strict structured profile:
- Core offer: What do they sell?
- Target customer: Who do they sell to?
- Industry: Category.
- Company size estimate: Size based on web evidence.
- Buying signals: Expansion, hiring, pain points.
NO creative writing. NO outreach content.
MANUAL RESEARCH INSTRUCTIONS: ${companyContext.manualResearch || "None provided."}
Assign 'match_score' (1-10) against goal: ${companyContext.goal}.`,
        model: getSafeModel('profiler'),
        model: getSafeModel('profiler'),
        tools: getToolsForAgent('company_profiler')
        // outputType removed to prevent premature validation
    });

    // 3. Apollo (Lead Finder): GPT-4 Turbo
    const getApolloAgent = () => new Agent({
        name: "Apollo Agent",
        instructions: `GOAL: Generate precise Apollo filters only. 
PROTOCOL: Take domain + company profile. Generate filters for contacts.
STRICTURE: Use GPT-4 Turbo logic to be reliable. Do NOT improvise filters.
CONTEXT: Goal for ${companyContext.name} is ${companyContext.goal}. Match these types: ${companyContext.baselineTitles.join(', ')}.`,
        model: AGENT_MODELS.apollo_lead_finder, // GPT-4 Turbo is always safe
        model: AGENT_MODELS.apollo_lead_finder, // GPT-4 Turbo is always safe
        tools: getToolsForAgent('apollo_lead_finder')
        // outputType removed to prevent premature validation
    });

    // 4. Outreach Creator: Gemini 1.5 Flash
    const getOutreachAgent = () => new Agent({
        name: "Outreach Creator",
        instructions: `GOAL: Generate personalized outreach.
PROTOCOL: Use strict message templates. Inject personalization fields only. 
STRICTURE: No decision-making. No research. No tone exploration.`,
        model: getSafeModel('outreach'),
        model: getSafeModel('outreach'),
        tools: []
        // outputType removed to prevent premature validation
    });

    // 5. Data Architect: Claude 3.5 Sonnet (Fallback)
    const getArchitectAgent = () => new Agent({
        name: "Data Architect",
        instructions: `GOAL: Normalize, validate, and store data.
PROTOCOL: Use strict schema. Normalize names (CapitalCase), fix broken URLs, and validate emails.
STRICTURE: LLM is fallback only. Zero creativity. If data is unsalvageable, mark is_valid: false.`,
        model: getSafeModel('architect'),
        model: getSafeModel('architect')
        // outputType removed to prevent premature validation
    });

    // --- Main Workflow Loop ---
    let globalLeads = [];
    let scrapedNamesSet = new Set();
    const excludedNames = await getExcludedCompanyNames(userId);
    const leadScraper = new LeadScraperService();
    let attempts = 0;
    const MAX_ATTEMPTS = 5; // Allow for thorough discovery
    let totalSearches = 0;
    const MAX_SEARCHES = 20;
    let masterQualifiedList = [];

    // --- Phase 1: Discovery & Profiling Loop ---
    // User Requirement: Stop ONLY when 30 qualified companies are found (or target met)
    while (masterQualifiedList.length < targetLeads && attempts < MAX_ATTEMPTS) {
        if (await checkCancellation()) break;
        attempts++;
        logStep('Workflow', `Discovery Round ${attempts}: Collecting companies...`);

        // 1. Discovery
        let candidates = [];
        try {
            if (totalSearches >= MAX_SEARCHES) {
                logStep('Company Finder', `🛑 Search limit reached (${MAX_SEARCHES}). Stopping discovery.`);
                break;
            }
            totalSearches++;
            const finderRes = await runAgentWithTracking(runner, getFinderAgent(), [
                { role: "user", content: `Find companies for: ${input.input_as_text}. Avoid: ${[...scrapedNamesSet, ...excludedNames, ...masterQualifiedList.map(c => c.company_name)].slice(0, 50).join(', ')}` }
            ], costTracker, { maxTurns: 20 });

            // HARD CONTRACT ENFORCEMENT
            const normalizedFinder = enforceAgentContract({
                agentName: "Company Finder",
                rawOutput: finderRes.finalOutput,
                schema: CompanyFinderSchema
            });

            candidates = (normalizedFinder.results || [])
                .map(c => ({
                    ...c,
                    company_name: c.companyName || c.company_name // Polyfill for schema drift
                }))
                .filter(c => !scrapedNamesSet.has(c.company_name));
        } catch (e) {
            logStep('Company Finder', `Failed: ${e.message}`);
        }

        if (candidates.length === 0) {
            logStep('Workflow', 'No new candidates found in this round.');
            break;
        }

        // 2. Profiling & Filtering
        try {
            if (await checkCancellation()) break;
            logStep('Company Profiler', `Analyzing ${candidates.length} candidates...`);
            const profilerRes = await runAgentWithTracking(runner, getProfilerAgent(), [{ role: "user", content: JSON.stringify(candidates) }], costTracker, { maxTurns: 20 });
            const profiled = profilerRes.finalOutput?.results || [];

            const qualified = profiled.filter(c => {
                const isHighQuality = (c.match_score || 0) >= 7;
                if (!isHighQuality) logStep('Profiler', `🗑️ Dropped ${c.company_name} (Score: ${c.match_score}/10)`);
                return isHighQuality;
            });

            masterQualifiedList.push(...qualified);
            logStep('Company Profiler', `Round ${attempts}: +${qualified.length} Qualified. Total: ${masterQualifiedList.length}`);
        } catch (e) {
            logStep('Company Profiler', `Analysis failed: ${e.message}`);
        }
    }

    // --- Phase 1 Check: Data Starvation Protection ---
    if (masterQualifiedList.length === 0) {
        logStep('Workflow', '❌ No qualified companies found after discovery. Stopping workflow to prevent hallucination.');
        return {
            status: 'failed',
            leads: [],
            stats: { total: 0, attempts, cost: costTracker.getSummary() },
            error: "Discovery failed: No qualified companies found."
        };
    }

    // --- Phase 2: Consolidated Lead Scraping (ONE Pass) ---
    // Already protected by the check above, but keeping structure
    if (masterQualifiedList.length > 0) {
        logStep('Lead Finder', `🚀 Triggering Scraper for ALL ${masterQualifiedList.length} qualified companies...`);
        try {
            if (await checkCancellation()) return;

            const leads = await leadScraper.fetchLeads(masterQualifiedList, filters, logStep, checkCancellation);

            // --- Phase 2 Check: Data Starvation Protection ---
            if (leads.length === 0) {
                logStep('Workflow', '❌ No leads found from scraped companies. Stopping before Outreach.');
                return {
                    status: 'failed',
                    leads: [],
                    stats: { total: 0, attempts, cost: costTracker.getSummary() },
                    error: "Scraping failed: No leads found."
                };
            }

            if (leads.length > 0) {
                logStep('Data Architect', `Normalizing ${leads.length} leads...`);

                // 4. Data Architect: Validation & Normalization
                const deterministicLeads = leads.filter(l => l.first_name && l.last_name && l.email);
                const ambiguousLeads = leads.filter(l => !l.first_name || !l.last_name || !l.email);
                let fixedLeads = [];

                if (ambiguousLeads.length > 0) {
                    try {
                        const architectRes = await runAgentWithTracking(runner, getArchitectAgent(), [{ role: "user", content: `Normalize these ambiguous leads: ${JSON.stringify(ambiguousLeads)}` }], costTracker);
                        fixedLeads = (architectRes.finalOutput?.leads || []).filter(l => l.is_valid);
                    } catch (e) {
                        logStep('Data Architect', `Normalization failed: ${e.message}`);
                    }
                }

                const validatedLeads = [...deterministicLeads, ...fixedLeads];

                // 5. Ranking & Deduplication
                if (validatedLeads.length > 0) {
                    const rankRes = await runAgentWithTracking(runner, getApolloAgent(), [{ role: "user", content: `Rank these leads (Match 1-10) for ${companyContext.goal}: ${JSON.stringify(validatedLeads.slice(0, 50))}` }], costTracker);
                    const ranked = rankRes.finalOutput?.leads || validatedLeads;
                    const sorted = ranked.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

                    const perCompany = {};
                    sorted.forEach(l => {
                        if (!perCompany[l.company_name]) perCompany[l.company_name] = [];
                        if (perCompany[l.company_name].length < maxLeadsPerCompany) perCompany[l.company_name].push(l);
                    });

                    const added = Object.values(perCompany).flat();
                    globalLeads.push(...added);
                    logStep('Workflow', `✅ Finalized ${globalLeads.length} leads.`);
                }
            }

            // Mark companies as processed
            masterQualifiedList.forEach(c => scrapedNamesSet.add(c.company_name));
        } catch (e) {
            logStep('Lead Finder', `Scraping failed: ${e.message}`);
        }
    }

    // --- Outreach Generation ---
    logStep('Outreach Creator', `Drafting messages for ${globalLeads.length} leads...`);
    let finalLeads = [];
    try {
        const outreachRes = await runAgentWithTracking(runner, getOutreachAgent(), [{ role: "user", content: JSON.stringify(globalLeads.slice(0, 20)) }], costTracker);

        // HARD CONTRACT ENFORCEMENT
        const normalizedOutreach = enforceAgentContract({
            agentName: "Outreach Creator",
            rawOutput: outreachRes.finalOutput,
            schema: OutreachCreatorSchema
        });

        finalLeads = normalizedOutreach.leads?.length > 0 ? normalizedOutreach.leads : globalLeads;
    } catch (e) {
        logStep('Outreach Creator', `Failed: ${e.message}`);
        if (e.message?.includes("API key not valid")) useGoogleFallback = true;
        finalLeads = globalLeads;
    }

    // --- Save to CRM ---
    await saveLeadsToDB(finalLeads, userId, icpId, logStep);

    return {
        status: globalLeads.length >= targetLeads ? 'success' : 'partial',
        leads: finalLeads,
        stats: {
            total: globalLeads.length,
            attempts,
            cost: costTracker.getSummary()
        }
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
