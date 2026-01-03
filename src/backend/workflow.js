// NO MORE @openai/agents - Using direct SDK runners only
import { checkApifyRun, getApifyResults, performGoogleSearch, scrapeCompanyWebsite, scanSiteStructure, scrapeSpecificPages, scrapeWebsiteSmart } from "./services/apify.js";
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

    /**
     * Helper: Smart Page Selection using LLM
     */
    const selectRelevantPages = async (domain, links, icpDescription) => {
        if (!links || links.length === 0) return [];

        try {
            const prompt = `
            I am analyzing the company at ${domain} to see if it matches this Ideal Customer Profile (ICP):
            "${icpDescription || 'General analysis'}"
            
            AVAILABLE PAGES FROM SITEMAP:
            ${links.slice(0, 150).join('\n')}
            
            TASK: Select the Top 10 most relevant URLs that would likely contain:
            - Explicit investment criteria / strategy
            - Portfolio / Track record / Case studies
            - Team / Leadership / Partners
            - About Us / Company Overview
            
            OUTPUT: Return ONLY a raw JSON object with a "urls" array. No markdown.
            Example: {"urls": ["https://example.com/portfolio", "https://example.com/team"]}
            `;

            const response = await runGeminiAgent({
                apiKey: googleKey,
                modelName: 'gemini-2.0-flash', // Fast & Cheap
                agentName: 'Page Selector',
                instructions: "You are a web scraper helper. Pick the best URLs for analysis.",
                userMessage: prompt,
                tools: [] // No tools needed, just reasoning
            });

            // Parse JSON output
            let selected = [];
            try {
                const jsonStr = response.finalOutput.replace(/```json/g, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(jsonStr);
                if (parsed.urls && Array.isArray(parsed.urls)) selected = parsed.urls;
            } catch (e) {
                console.warn("Failed to parse page selection JSON", e);
            }

            return selected.length > 0 ? selected : links.slice(0, 10); // Fallback to first 10

        } catch (err) {
            console.warn(`Smart page selection failed for ${domain}:`, err.message);
            return links.slice(0, 10); // Fallback
        }
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

                    CRITICAL NEGATIVE FILTERS:
                    - NO Stock Exchanges (e.g. NASDAQ / NYSE)
                    - NO Market Indices (e.g. S&P 500)
                    - NO Job Boards / Recruitment Sites / CV databases
                    - NO General News Sites / Wikipedia
                    - NO Government Portals / Regulatory agencies
                    - NO Service Providers (unless they are also investors)

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
                        logStep('Company Profiler', `Analyzing ${candidate.companyName} (${candidate.domain})...`);

                        // 1. SMART SCRAPING (Discover -> Select -> Scrape)
                        let finalContent = "";
                        try {
                            // Use scrapeWebsiteSmart for discovery + fallback selection
                            const { links, content: fallbackContent } = await scrapeWebsiteSmart(candidate.domain);
                            finalContent = fallbackContent;

                            // If "Deep Dive" is requested or we have many links, use LLM to pick best pages
                            if (companyContext.depth === "Deep Dive (News, LinkedIn, Reports)" && links.length > 5) {
                                logStep('Company Profiler', `🧠 Smart Selecting pages for ${candidate.domain}...`);
                                const bestUrls = await selectRelevantPages(candidate.domain, links, companyContext.icpDescription);

                                // Re-scrape exactly the chosen pages
                                if (bestUrls.length > 0) {
                                    finalContent = await scrapeSpecificPages(bestUrls, apifyToken, checkCancellation);
                                }
                            }
                        } catch (scrapeErr) {
                            console.warn("Smart scraping failed, falling back to empty content", scrapeErr);
                            finalContent = "Error scraping website.";
                        }

                        // 2. GENERATE PROFILE (Single LLM Call)
                        const profilePrompt = `
                        I have scraped the website of ${candidate.companyName} (${candidate.domain}).
                        
                        WEBSITE CONTENT:
                        ${(finalContent || "").slice(0, 25000)} 
                        
                        YOUR TASK:
                        Analyze this content and create a detailed Company Profile JSON.
                        
                        COMPANY PROFILE REQUIREMENTS:
                        Structure the company_profile into a "Proper Report" using these Markdown headers:
                        
                        # Summary
                        (2-3 sentences about core business and scale)
                        
                        # Investment Strategy 
                        (Detailed breakdown of their approach, target asset classes, and GP/LP status)
                        
                        # Scale & Geographic Focus
                        (AUM, office locations, and history)
                        
                        # Portfolio Observations
                        (Key insights about their existing portfolio or previous similar deals)

                        # Key Highlights
                        - Use bullet points for critical stats or unique edges.

                        USER REQUIREMENTS:
                        ${companyContext.profileContent || "Extract key stats and focus."}
                        
                        SCORING CRITERIA (0-10):
                        - 10: Perfect fit (${companyContext.keyAttributes || "Clear match"})
                        - 1: Poor fit (${companyContext.redFlags || "Mismatch"})
                        
                        OUTPUT JSON:
                        {"results": [{"company_name": "${candidate.companyName}", "domain": "${candidate.domain}", "company_profile": "...", "match_score": 8}]}
                        `;

                        // Single LLM Call
                        const profilerRes = await runGeminiAgent({
                            apiKey: googleKey,
                            modelName: 'gemini-2.0-flash',
                            agentName: 'Company Profiler',
                            instructions: "You are a senior investment analyst. Analyze the scraped text and output JSON.",
                            userMessage: profilePrompt,
                            tools: []
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
                        logStep('Company Profiler', `Failed to analyze ${candidate.companyName}: ${err.message} `);
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
                logStep('Company Profiler', `Round ${attempts}: +${qualified.length} Qualified.Total: ${masterQualifiedList.length} `);
            } catch (e) {
                logStep('Company Profiler', `Analysis loop failed: ${e.message} `);
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
                const scrapeFilters = { ...filters, idempotencyKey: idempotencyKey || `wf_${Date.now()} ` };
                const scrapeResult = await leadScraper.fetchLeads(masterQualifiedList, scrapeFilters, logStep, checkCancellation);

                // Handle new return structure { leads, disqualified }
                const leadsFound = scrapeResult.leads || (Array.isArray(scrapeResult) ? scrapeResult : []);
                const disqualifiedFound = scrapeResult.disqualified || [];

                logStep('Lead Finder', `Found ${leadsFound.length} valid leads.Saving ${disqualifiedFound.length} disqualified leads for review.`);

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
                                instructions: `You are a data normalization agent.Your job is to fix and validate lead data.

For each lead:
                        1. Fix capitalization(FirstName LastName)
                        2. Validate email format
                        3. Fix broken URLs
                        4. Mark is_valid: true if data is usable, false if unsalvageable

OUTPUT FORMAT: Return JSON:
                        { "leads": [{ "first_name": "...", "last_name": "...", "email": "...", "is_valid": true, "company_profile": "PRESERVE_ORIGINAL_VALUE", ...}] }
                        CRITICAL: You MUST preserve the 'company_profile' field for every lead.Do not modify or drop it.`,
                                userMessage: `Normalize these ambiguous leads: ${JSON.stringify(ambiguousLeads)} `,
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
                            logStep('Data Architect', `Normalization failed: ${e.message} `);
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
                                instructions: `You are a lead ranking agent. Score each lead from 1-10 based on fit.

SCORING CRITERIA:
- 10: Perfect title match, decision maker at target company
- 7-9: Good title, relevant role
- 4-6: Related role, might be useful
- 1-3: Low relevance

GOAL: ${companyContext.goal}
TARGET TITLES: ${companyContext.baselineTitles?.join(', ') || 'Decision makers'}

OUTPUT FORMAT: Return JSON array with email and match_score:
{ "leads": [{ "email": "...", "match_score": 8 }] }`,
                                userMessage: `Rank these leads: ${JSON.stringify(validatedLeads.slice(0, 50).map(l => ({ email: l.email, title: l.title, company: l.company_name })))}`,
                                tools: [],
                                maxTurns: 2,
                                logStep: logStep
                            });

                            const rankedParsed = enforceAgentContract({
                                agentName: "Lead Ranker",
                                rawOutput: rankRes.finalOutput,
                                schema: z.object({
                                    leads: z.array(z.object({
                                        email: z.string(),
                                        match_score: z.number()
                                    }))
                                })
                            });

                            // MERGE SCORES BACK to validatedLeads (Preserves company_profile)
                            const scoreMap = new Map((rankedParsed.leads || []).map(l => [l.email, l.match_score]));

                            const ranked = validatedLeads.map(l => ({
                                ...l,
                                match_score: scoreMap.get(l.email) || 5 // Default score if ranking fails/skips
                            }));

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
                            // Fallback: use unranked leads with default score
                            const fallback = validatedLeads.slice(0, 20).map(l => ({ ...l, match_score: 5 }));
                            globalLeads.push(...fallback);
                        }
                    }
                }

                // Mark companies as processed
                masterQualifiedList.forEach(c => scrapedNamesSet.add(c.company_name));
            } catch (e) {
                logStep('Lead Finder', `Scraping failed: ${e.message} `);
            }
        }

        // --- Outreach Generation ---
        logStep('Outreach Creator', `Drafting messages for ${globalLeads.length} leads in batches...`);
        let finalLeads = [];
        const BATCH_SIZE = 20;

        for (let i = 0; i < globalLeads.length; i += BATCH_SIZE) {
            const batch = globalLeads.slice(i, i + BATCH_SIZE);
            logStep('Outreach Creator', `Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(globalLeads.length / BATCH_SIZE)}...`);

            try {
                const outreachRes = await runGeminiAgent({
                    apiKey: googleKey,
                    modelName: 'gemini-2.0-flash',
                    agentName: 'Outreach Creator',
                    instructions: `You are an outreach copywriter. Create personalized messages for these leads.

                            TEMPLATE: ${companyContext.outreachTemplate || "Hi {{first_name}}, saw you're at {{company_name}}."}

                        INSTRUCTIONS:
                        1. Replace placeholders using lead data.
                        2. EXTRACT specific, impressive facts from 'company_profile'. 
                        3. DO NOT use generic placeholders like "X", "[Industry]", or "[Topic]". If you don't find a specific fact, use a high-quality observation about their market position.
                        4. CRITICAL: 'connection_request' MUST be under 300 characters.
                        5. Professional but conversational. No hashtags or emojis.

                        OUTPUT FORMAT: Return JSON:
                        { "leads": [{ "email": "...", "connection_request": "...", "email_subject": "...", "email_message": "..." }] } `,
                    userMessage: `Draft outreach for these leads. Use their 'company_profile' for personalization: ${JSON.stringify(batch)} `,
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

                const batchResponses = normalizedOutreach.leads || [];

                // Map results for this batch
                const outreachMap = new Map(batchResponses.map(l => [l.email, l]));

                batch.forEach(original => {
                    let processedLead = { ...original };
                    const update = outreachMap.get(original.email);

                    if (update) {
                        processedLead = {
                            ...original,
                            email_message: update.email_message || update.email_body || original.email_message,
                            email_subject: update.email_subject || original.email_subject,
                            connection_request: update.connection_request || original.connection_request
                        };
                    }

                    // SAFETY: Enforce 300-char hard limit
                    if (processedLead.connection_request && processedLead.connection_request.length > 300) {
                        processedLead.connection_request = processedLead.connection_request.substring(0, 295) + '...';
                    }

                    finalLeads.push(processedLead);
                });

            } catch (e) {
                logStep('Outreach Creator', `Batch failed: ${e.message}. Falling back to original data for this batch.`);
                finalLeads.push(...batch);
            }
        }

        // --- Save to CRM ---
        await saveLeadsToDB(finalLeads, userId, icpId, logStep);

        return {
            status: finalLeads.length >= targetLeads ? 'success' : 'partial',
            leads: finalLeads,
            stats: {
                leads_returned: finalLeads.length,
                qualified: finalLeads.length,
                leadsDisqualified: totalDisqualified,
                companies_discovered: masterQualifiedList.length,
                attempts,
                cost: costTracker.getSummary()
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

            await query(`INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, source, user_id, custom_data)
                        VALUES($1, $2, $3, $4, $5, $6, 'Outbound Agent', $7, $8)`,
                [lead.company_name, `${lead.first_name} ${lead.last_name} `, lead.email, lead.title, lead.linkedin_url, forceStatus, userId, {
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
    if (count > 0) logStep('Database', `Saved ${count} leads(Status: ${forceStatus}) to CRM.`);
};

/**
 * Manual Enrichment (Helper)
 */
export const enrichLeadWithPhone = async (lead) => {
    return [];
};
