// NO MORE @openai/agents - Using direct SDK runners only
import { checkApifyRun, getApifyResults, performGoogleSearch, scrapeCompanyWebsite, scanSiteStructure, scrapeSpecificPages } from "./services/apify.js";
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
import { enforceAgentContract } from "./utils/agent-contract.js";
import { runGeminiAgent } from "./services/direct-agent-runner.js";

// --- Schema Definitions ---
console.log("✅ WORKFLOW.JS - DIRECT SDK MODE (No OpenAI)");

const CompanyFinderSchema = z.object({
    results: z.array(z.object({
        company_name: z.string().optional(),
        companyName: z.string().optional(),
        domain: z.string().optional().or(z.literal("")).or(z.null()),
        primaryDomain: z.string().optional(),
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
        date_added: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        company_name: z.string().optional(),
        title: z.string().optional(),
        email: z.string().optional(),
        linkedin_url: z.string().optional(),
        company_website: z.string().optional(),
        connection_request: z.string().optional(),
        email_message: z.string().optional(),
        linkedin_message: z.string().optional(),
        email_subject: z.string().optional(),
        email_body: z.string().optional(),
        company_profile: z.string().optional()
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

    // NOTE: getToolsForAgent removed - tools are now defined inline with runGeminiAgent() calls

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
                if (cfg.surveys && cfg.surveys.company_profiler) {
                    const profiler = cfg.surveys.company_profiler;
                    if (profiler.manual_research) companyContext.manualResearch = profiler.manual_research;
                    if (profiler.key_attributes) companyContext.keyAttributes = profiler.key_attributes;
                    if (profiler.red_flags) companyContext.redFlags = profiler.red_flags;
                    if (profiler.profile_content) companyContext.profileContent = profiler.profile_content;
                }
                // Read Company Finder settings
                if (cfg.surveys && cfg.surveys.company_finder) {
                    const finder = cfg.surveys.company_finder;
                    if (finder.excluded_industries) companyContext.excludedIndustries = finder.excluded_industries;
                    if (finder.icp_description) companyContext.icpDescription = finder.icp_description;
                    if (finder.strictness) companyContext.strictness = finder.strictness;
                }

                // --- CRITICAL: Populate Filters from ICP Config ---
                // If filters were not passed explicitly, use ICP config
                if (Object.keys(filters).length === 0 || !filters.job_titles) {
                    if (cfg.job_titles) filters.job_titles = cfg.job_titles;
                    if (cfg.seniority) filters.seniority = cfg.seniority;
                    if (cfg.excluded_functions) filters.excluded_functions = cfg.excluded_functions;
                    if (cfg.max_contacts) filters.maxLeads = cfg.max_contacts;
                    if (cfg.geography) filters.geography = cfg.geography;
                }
                // Always pass excluded industries from company finder settings (outside the conditional block)
                if (companyContext.excludedIndustries) {
                    // Split by common delimiters (comma, newline) and clean up
                    const industries = companyContext.excludedIndustries
                        .split(/[,\n]/)
                        .map(s => s.trim())
                        .filter(Boolean);
                    if (industries.length > 0) filters.excludedIndustries = industries;
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

    // --- Direct SDK Mode - No @openai/agents ---
    const costTracker = new CostTracker(`wf_${Date.now()}`);

    // --- API Key Validation ---
    const rawGoogleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    const googleKey = (typeof rawGoogleKey === 'string' && rawGoogleKey.length > 10) ? rawGoogleKey.trim().replace(/[\s\r\n\t]/g, '') : null;

    if (!googleKey) {
        throw new Error('GOOGLE_API_KEY is required. Set it in environment variables.');
    }
    logStep('System', `🔑 Google Key: ${googleKey.substring(0, 7)}...${googleKey.substring(googleKey.length - 4)} (Len: ${googleKey.length})`);

    // Log filters from onboarding
    logStep('System', `Using filters from onboarding: ${JSON.stringify(filters)}`);

    // NOTE: All @openai/agents Agent definitions removed
    // We now use runGeminiAgent() directly inline with tool definitions
    // This bypasses @openai/agents entirely and uses Google's official SDK

    // --- Main Workflow Loop (Wrapped for error cost capture) ---
    try {
        let globalLeads = [];
        let scrapedNamesSet = new Set();
        const excludedNames = await getExcludedCompanyNames(userId);
        const leadScraper = new LeadScraperService();
        let attempts = 0;
        const MAX_ATTEMPTS = 5; // Allow for thorough discovery
        let totalSearches = 0;
        const MAX_SEARCHES = 20;
        let masterQualifiedList = [];
        let totalDiscovered = 0;
        let totalDisqualified = 0;

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

                // Use direct Gemini runner with proper tool execution
                const apifyToken = process.env.APIFY_API_TOKEN;
                const finderRes = await runGeminiAgent({
                    apiKey: googleKey,
                    modelName: 'gemini-2.0-flash',
                    agentName: 'Company Finder',
                    instructions: `You are a company discovery agent. Your task is to find companies that match a SPECIFIC Ideal Customer Profile (ICP).

USER'S ICP DESCRIPTION:
"${companyContext.icpDescription || input.input_as_text}"

STRICTNESS LEVEL: ${companyContext.strictness || 'Moderate'}
${companyContext.strictness?.includes('Strict') ? '⚠️ STRICT MODE: Only include EXACT matches. No adjacent industries or company types.' : ''}
${companyContext.strictness?.includes('Flexible') ? '✅ FLEXIBLE MODE: Include companies from adjacent/similar industries if they might be relevant.' : ''}

MUST-HAVE CRITERIA: ${companyContext.keyAttributes || 'See ICP description'}
EXCLUDED INDUSTRIES (NEVER INCLUDE): ${companyContext.excludedIndustries || 'None specified'}

STEP 1: Call the google_search_and_extract tool ONCE with a query that will find companies matching the ICP above. Be specific with industry, geography, and company type.

STEP 2: Parse the search results. For each result, evaluate if it ACTUALLY matches the ICP based on the strictness level:
- STRICT: Company must be in the EXACT industry described. No exceptions.
- MODERATE: Company should be in the target industry or closely related.
- FLEXIBLE: Company can be in adjacent industries if there's potential overlap.

STEP 3: Return a JSON object with ONLY the companies that match. Example:
{"results": [{"companyName": "Tricon Residential", "domain": "triconresidential.com", "description": "Multi-family rental housing investor in Canada with $10B+ AUM"}, ...]}

CRITICAL RULES:
- Do NOT call the search tool more than 1-2 times
- After searching, you MUST return JSON results
- STRICTLY REJECT any company in these excluded industries: ${companyContext.excludedIndustries || 'None specified'}
- Apply the strictness level when deciding which companies to include
- Extract at least 5-10 RELEVANT companies from search results
- If a URL is like "example.com/page", the domain is "example.com"
- Do not include directories like "top 10 lists" as companies themselves`,
                    userMessage: `Find companies matching this ICP: "${companyContext.icpDescription || input.input_as_text}"

STRICTNESS: ${companyContext.strictness || 'Moderate'}
EXCLUDED INDUSTRIES: ${companyContext.excludedIndustries || 'None'}

Companies to AVOID (already scraped): ${[...scrapedNamesSet, ...excludedNames, ...masterQualifiedList.map(c => c.company_name)].slice(0, 30).join(', ') || 'none yet'}`,
                    tools: [
                        {
                            name: "google_search_and_extract",
                            description: "Search using Google and return organic results (Title, URL, Snippet). Use this to find company websites.",
                            parameters: {
                                properties: { query: { type: "string", description: "Google search query" } },
                                required: ["query"]
                            },
                            execute: async ({ query }) => {
                                logStep('Company Finder', `🔍 Google Search: "${query}"`);
                                const results = await performGoogleSearch(query, apifyToken, checkCancellation);
                                return results.map(r => `TITLE: ${r.title}\nURL: ${r.link}\nSNIPPET: ${r.snippet}`).join('\n---\n');
                            }
                        }
                    ],
                    maxTurns: 3, // 1 search + extraction + maybe 1 more search
                    logStep: logStep
                });

                // Track cost
                costTracker.recordCall({
                    agent: 'Company Finder',
                    model: 'gemini-2.0-flash',
                    inputTokens: finderRes.usage?.inputTokens || 0,
                    outputTokens: finderRes.usage?.outputTokens || 0,
                    duration: 0,
                    success: true
                });

                // HARD CONTRACT ENFORCEMENT
                const normalizedFinder = enforceAgentContract({
                    agentName: "Company Finder",
                    rawOutput: finderRes.finalOutput,
                    schema: CompanyFinderSchema
                });

                candidates = (normalizedFinder.results || []).filter(c => !scrapedNamesSet.has(c.company_name || c.companyName));
                totalDiscovered += candidates.length;
            } catch (e) {
                logStep('Company Finder', `Failed: ${e.message}`);
            }

            if (candidates.length === 0) {
                logStep('Workflow', 'No new candidates found in this round.');
                break;
            }

            // 2. Profiling & Filtering - Use direct Gemini runner
            // 2. Profiling & Filtering - Use direct Gemini runner
            // SEQUENTIAL PROCESSING to control costs (Apify is expensive)
            try {
                if (await checkCancellation()) break;
                logStep('Company Profiler', `Analyzing ${candidates.length} candidates sequentially...`);

                const apifyToken = process.env.APIFY_API_TOKEN;
                const batchResults = [];

                // Process each candidate one by one
                for (const candidate of candidates) {
                    if (await checkCancellation()) break;

                    try {
                        const profilerRes = await runGeminiAgent({
                            apiKey: googleKey,
                            modelName: 'gemini-2.0-flash',
                            agentName: 'Company Profiler',
                            instructions: `You are a company research and qualification agent.
                            
Analyze this specific company:
NAME: ${candidate.companyName}
DOMAIN: ${candidate.domain}
DESC: ${candidate.description}

You need to:
1. Use scan_site_structure('${candidate.domain}') to see pages
2. Use scrape_specific_pages([urls]) to get About/Team/Portfolio/Services content
3. Analyze if they are a good fit

OUTPUT FORMAT: Return JSON:
{"results": [{"company_name": "${candidate.companyName}", "domain": "${candidate.domain}", "company_profile": "...", "match_score": 8}]}

COMPANY PROFILE REQUIREMENTS (CRITICAL):
The company_profile MUST be 4-10 sentences long and comprehensive. Include ALL of the following:
1. Company overview: What the company does (their core business/niche)
2. Scale & Size: Quantitative data (e.g., "$X billion in assets", "X projects", "X employees", "founded in XXXX")
3. Geographic focus: Where they operate (cities, regions, countries)
4. Key services/products: What specific services or products they offer
5. Notable achievements: Awards, rankings, major projects, partnerships
6. Market position: Their competitive position or unique value proposition
7. Why they might be a good fit for our services

USER-SPECIFIC PROFILE REQUIREMENTS:
${companyContext.profileContent || "Extract any notable data points about the company's size, focus, and market position."}

BAD EXAMPLE (too short): "Fiera Capital manages assets."
GOOD EXAMPLE (4-10 sentences): "Fiera Capital is a Montreal-based investment manager founded in 2003, managing over $180 billion in assets across multiple asset classes. They specialize in alternative investments including real estate, private debt, and infrastructure, with particular strength in Canadian institutional markets. The firm operates offices across Canada, the US, and Europe, serving pension funds, endowments, and high-net-worth individuals. Fiera has been recognized as one of Canada's fastest-growing independent asset managers and recently expanded their private credit portfolio through strategic acquisitions. They are actively seeking partnerships with real estate developers for co-investment opportunities in the residential sector."

SCORING CRITERIA (match_score 1-10):
- 10: Perfect match (Must have: ${companyContext.keyAttributes || "Clear fit"})
- 7-9: Good fit with strong relevance
- 4-6: Maybe, lacking key criteria
- 1-3: Poor fit (Red Flags: ${companyContext.redFlags || "None defined"})

USER RESEARCH INSTRUCTIONS:
"${companyContext.manualResearch || "Check for fit."}"

GOAL: ${companyContext.goal}`,
                            userMessage: `Analyze ${candidate.companyName}. Create a COMPREHENSIVE company profile (4-10 sentences with specific details from their website). Focus on: ${companyContext.profileContent || 'size, market position, services'}. Verify these MUST-HAVES: ${companyContext.keyAttributes || 'General fit'}`,
                            tools: [
                                {
                                    name: "scan_site_structure",
                                    description: "Scan a website's homepage/sitemap to discover available pages and links",
                                    parameters: {
                                        properties: { domain: { type: "string", description: "Domain to scan, e.g. 'example.com'" } },
                                        required: ["domain"]
                                    },
                                    execute: async ({ domain }) => {
                                        logStep('Company Profiler', `📡 Scanning: ${domain}`);
                                        return await scanSiteStructure(domain, apifyToken, checkCancellation);
                                    }
                                },
                                {
                                    name: "scrape_specific_pages",
                                    description: "Scrape content from specific URLs",
                                    parameters: {
                                        properties: { urls: { type: "array", items: { type: "string" }, description: "URLs to scrape" } },
                                        required: ["urls"]
                                    },
                                    execute: async ({ urls }) => {
                                        logStep('Company Profiler', `📄 Scraping ${urls.length} pages`);
                                        return await scrapeSpecificPages(urls, apifyToken, checkCancellation);
                                    }
                                }
                            ],
                            maxTurns: 5,
                            logStep: logStep
                        });

                        costTracker.recordCall({
                            agent: 'Company Profiler',
                            model: 'gemini-2.0-flash',
                            inputTokens: profilerRes.usage?.inputTokens || 0,
                            outputTokens: profilerRes.usage?.outputTokens || 0,
                            duration: 0,
                            success: true
                        });

                        const analyzed = enforceAgentContract({
                            agentName: "Company Profiler",
                            rawOutput: profilerRes.finalOutput,
                            schema: CompanyProfilerSchema
                        }).results || [];

                        batchResults.push(...analyzed);

                    } catch (err) {
                        logStep('Company Profiler', `Failed to analyze ${candidate.companyName}: ${err.message}`);
                    }
                }

                const qualified = batchResults.filter(c => {
                    const isHighQuality = (c.match_score || 0) >= 7;
                    if (!isHighQuality) {
                        logStep('Profiler', `🗑️ Dropped ${c.company_name} (Score: ${c.match_score}/10)`);
                        totalDisqualified++;
                    }
                    return isHighQuality;
                });

                masterQualifiedList.push(...qualified);
                // IMMEDIATELY add to scrapedNamesSet to prevent re-discovery in next round
                qualified.forEach(c => scrapedNamesSet.add(c.company_name));
                logStep('Company Profiler', `Round ${attempts}: +${qualified.length} Qualified. Total: ${masterQualifiedList.length}`);
            } catch (e) {
                logStep('Company Profiler', `Analysis loop failed: ${e.message}`);
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

                // --- 4. Lead Scraping with Disqualified Tracking ---
                // Pass idempotencyKey to prevent duplicate Apify runs on retries
                const scrapeFilters = { ...filters, idempotencyKey: idempotencyKey || `wf_${Date.now()}` };
                const scrapeResult = await leadScraper.fetchLeads(masterQualifiedList, scrapeFilters, logStep, checkCancellation);

                // Handle new return structure { leads, disqualified }
                const leadsFound = scrapeResult.leads || (Array.isArray(scrapeResult) ? scrapeResult : []);
                const disqualifiedFound = scrapeResult.disqualified || [];

                logStep('Lead Finder', `Found ${leadsFound.length} valid leads. Saving ${disqualifiedFound.length} disqualified leads for review.`);

                // Save Disqualified Leads Immediately
                if (disqualifiedFound.length > 0) {
                    await saveLeadsToDB(disqualifiedFound, userId, icpId, logStep, 'DISQUALIFIED');
                }

                if (leadsFound.length === 0) {
                    logStep('Workflow', '❌ No leads found from scraped companies. Stopping before Outreach.');
                    return {
                        status: 'failed',
                        leads: [],
                        stats: { total: 0, attempts, cost: costTracker.getSummary() },
                        error: "Scraping failed: No leads found."
                    };
                }

                if (leadsFound.length > 0) {
                    logStep('Data Architect', `Normalizing ${leadsFound.length} leads...`);

                    // 4. Data Architect: Validation & Normalization
                    const deterministicLeads = leadsFound.filter(l => l.first_name && l.last_name && l.email);
                    const ambiguousLeads = leadsFound.filter(l => !l.first_name || !l.last_name || !l.email);
                    let fixedLeads = [];

                    if (ambiguousLeads.length > 0) {
                        try {
                            const architectRes = await runGeminiAgent({
                                apiKey: googleKey,
                                modelName: 'gemini-2.0-flash',
                                agentName: 'Data Architect',
                                instructions: `You are a data normalization agent. Your job is to fix and validate lead data.

For each lead:
1. Fix capitalization (FirstName LastName)
2. Validate email format
3. Fix broken URLs
4. Mark is_valid: true if data is usable, false if unsalvageable

OUTPUT FORMAT: Return JSON:
{"leads": [{"first_name": "...", "last_name": "...", "email": "...", "is_valid": true, "company_profile": "PRESERVE_ORIGINAL_VALUE", ...}]}
CRITICAL: You MUST preserve the 'company_profile' field for every lead. Do not modify or drop it.`,
                                userMessage: `Normalize these ambiguous leads: ${JSON.stringify(ambiguousLeads)}`,
                                tools: [],
                                maxTurns: 2,
                                logStep: logStep
                            });

                            const parsed = enforceAgentContract({
                                agentName: "Data Architect",
                                rawOutput: architectRes.finalOutput,
                                schema: z.object({ leads: z.array(z.any()) })
                            });
                            fixedLeads = (parsed.leads || []).filter(l => l.is_valid);

                            costTracker.recordCall({
                                agent: 'Data Architect',
                                model: 'gemini-2.0-flash',
                                inputTokens: architectRes.usage?.inputTokens || 0,
                                outputTokens: architectRes.usage?.outputTokens || 0,
                                duration: 0,
                                success: true
                            });
                        } catch (e) {
                            logStep('Data Architect', `Normalization failed: ${e.message}`);
                        }
                    }

                    const validatedLeads = [...deterministicLeads, ...fixedLeads];

                    // 5. Ranking & Deduplication
                    if (validatedLeads.length > 0) {
                        try {
                            const rankRes = await runGeminiAgent({
                                apiKey: googleKey,
                                modelName: 'gemini-2.0-flash',
                                agentName: 'Lead Ranker',
                                instructions: `You are a lead ranking agent.Score each lead from 1 - 10 based on fit.

SCORING CRITERIA:
                                - 10: Perfect title match, decision maker at target company
                                - 7 - 9: Good title, relevant role
                                - 4 - 6: Related role, might be useful
                                - 1 - 3: Low relevance

GOAL: ${companyContext.goal}
TARGET TITLES: ${companyContext.baselineTitles?.join(', ') || 'Decision makers'}

OUTPUT FORMAT: Return JSON array with match_score added:
                            { "leads": [{ "first_name": "...", "match_score": 8, "company_profile": "PRESERVE_ORIGINAL_VALUE", ...}] }
CRITICAL: You MUST preserve the 'company_profile' field for every lead.Do not modify or drop it.`,
                                userMessage: `Rank these leads: ${JSON.stringify(validatedLeads.slice(0, 50))}`,
                                tools: [],
                                maxTurns: 2,
                                logStep: logStep
                            });

                            const rankedParsed = enforceAgentContract({
                                agentName: "Lead Ranker",
                                rawOutput: rankRes.finalOutput,
                                schema: z.object({ leads: z.array(z.any()) })
                            });
                            const ranked = rankedParsed.leads || validatedLeads;
                            const sorted = ranked.sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

                            costTracker.recordCall({
                                agent: 'Lead Ranker',
                                model: 'gemini-2.0-flash',
                                inputTokens: rankRes.usage?.inputTokens || 0,
                                outputTokens: rankRes.usage?.outputTokens || 0,
                                duration: 0,
                                success: true
                            });

                            const perCompany = {};
                            sorted.forEach(l => {
                                if (!perCompany[l.company_name]) perCompany[l.company_name] = [];
                                if (perCompany[l.company_name].length < maxLeadsPerCompany) perCompany[l.company_name].push(l);
                            });

                            const added = Object.values(perCompany).flat();
                            globalLeads.push(...added);
                            logStep('Workflow', `✅ Finalized ${globalLeads.length} leads.`);
                        } catch (e) {
                            logStep('Lead Ranker', `Ranking failed: ${e.message}`);
                            // Fallback: use unranked leads
                            globalLeads.push(...validatedLeads.slice(0, 20));
                        }
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
            const outreachRes = await runGeminiAgent({
                apiKey: googleKey,
                modelName: 'gemini-2.0-flash',
                agentName: 'Outreach Creator',
                instructions: `You are an outreach copywriter. Create personalized messages for these leads.

TEMPLATE: ${companyContext.outreachTemplate || "Hi {{First_name}}, saw you're at {{Company}}. We help companies like yours with X."}

INSTRUCTIONS:
1. Replace {{...}} placeholders using the lead's data.
2. For {{research fact}} or similar placeholders, EXTRACT a specific, impressive fact from the 'company_profile' field.
3. CRITICAL: 'connection_request' MUST be under 300 characters. This is the LinkedIn connection request message.
4. Be professional but conversational.
5. No hashtags or emojis.

OUTPUT FORMAT: Return JSON:
{"leads": [{"first_name": "...", "email": "...", "connection_request": "LinkedIn message under 300 chars", "email_subject": "...", "email_body": "..."}]}`,
                userMessage: `Draft outreach for these leads. Use their 'company_profile' to find specific facts: ${JSON.stringify(globalLeads.slice(0, 20))}`,
                tools: [],
                maxTurns: 2,
                logStep: logStep
            });

            // HARD CONTRACT ENFORCEMENT
            const normalizedOutreach = enforceAgentContract({
                agentName: "Outreach Creator",
                rawOutput: outreachRes.finalOutput,
                schema: OutreachCreatorSchema
            });

            costTracker.recordCall({
                agent: 'Outreach Creator',
                model: 'gemini-2.0-flash',
                inputTokens: outreachRes.usage?.inputTokens || 0,
                outputTokens: outreachRes.usage?.outputTokens || 0,
                duration: 0,
                success: true
            });

            // Merge AI output with existing leads to preserve data
            const newLeads = normalizedOutreach.leads || [];

            // SAFETY: Enforce 300-char hard limit for connection_request
            newLeads.forEach(l => {
                if (l.connection_request && l.connection_request.length > 300) {
                    logStep('Outreach Creator', `⚠️ Message too long (${l.connection_request.length} chars). Truncating for ${l.email}.`);
                    l.connection_request = l.connection_request.substring(0, 295) + '...';
                }
            });

            if (newLeads.length > 0) {
                // Map new data by email for O(1) lookup
                const outreachMap = new Map(newLeads.map(l => [l.email, l]));

                finalLeads = globalLeads.map(original => {
                    const update = outreachMap.get(original.email);
                    if (update) {
                        return {
                            ...original,
                            email_message: update.email_message || update.email_body || original.email_message,
                            email_subject: update.email_subject || original.email_subject,
                            connection_request: update.connection_request || original.connection_request
                        };
                    }
                    return original;
                });
            } else {
                finalLeads = globalLeads;
            }
        } catch (e) {
            logStep('Outreach Creator', `Failed: ${e.message}`);
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
                cost: costTracker.getSummary(),
                companies_discovered: masterQualifiedList.length + totalDisqualified,
                qualified: masterQualifiedList.length,
                disqualified: totalDisqualified
            }
        };

    } catch (error) {
        // CRITICAL: Attach cost data to the error so server.js can save it even on failure
        console.error('[Workflow] Error occurred, attaching cost data to error object');
        error.stats = {
            partialStats: true,
            error: error.message,
            cost: costTracker.getSummary()
        };
        throw error; // Re-throw with attached cost data
    }
};

/**
 * DB Persistence
 */
const saveLeadsToDB = async (leads, userId, icpId, logStep, forceStatus = 'NEW') => {
    if (!leads || leads.length === 0) return;
    let count = 0;
    for (const lead of leads) {
        try {
            const exists = await query("SELECT id FROM leads WHERE email = $1 AND user_id = $2", [lead.email, userId]);
            if (exists.rows.length > 0) continue;

            await query(`INSERT INTO leads (company_name, person_name, email, job_title, linkedin_url, status, source, user_id, custom_data)
            VALUES ($1, $2, $3, $4, $5, $6, 'Outbound Agent', $7, $8)`,
                [lead.company_name, `${lead.first_name} ${lead.last_name}`, lead.email, lead.title, lead.linkedin_url, forceStatus, userId, {
                    icp_id: icpId,
                    score: lead.match_score,
                    company_profile: lead.company_profile, // Renamed from 'profile' for clarity
                    company_website: lead.company_website || lead.company_domain,
                    company_domain: lead.company_domain,
                    email_message: lead.email_message || lead.email_body,
                    email_subject: lead.email_subject,
                    connection_request: lead.connection_request, // Single source for LinkedIn message
                    disqualification_reason: lead.disqualification_reason
                }]);
            count++;
        } catch (e) {
            console.error('Failed to save lead:', e.message);
        }
    }
    if (count > 0) logStep('Database', `Saved ${count} leads (Status: ${forceStatus}) to CRM.`);
};

/**
 * Manual Enrichment (Helper)
 */
export const enrichLeadWithPhone = async (lead) => {
    return [];
};
