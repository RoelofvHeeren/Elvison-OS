// NO MORE @openai/agents - Using direct SDK runners only
import { checkApifyRun, getApifyResults, scrapeCompanyWebsite, scanSiteStructure, scrapeSpecificPages, scrapeWebsiteSmart } from "./services/apify.js";
import { runGoogleSearch } from "./services/google-search-service.js";
import { getTermStrings, markTermsAsUsed, initializeSearchTermsIfEmpty, generateSearchTerms, addSearchTerms } from "./services/search-term-manager.js";
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

const normalizeCompanyName = (name) => {
    if (!name) return "";
    return name.toLowerCase()
        .replace(/\b(inc|incorporated|ltd|limited|llc|corp|corporation|group|global|holdings|capital|partners|management|advisors|associates|sa|ag|solutions|services|trust|equity|development|properties|reit|real estate|private equity|investment counsel|division of|division|investments|commercial real estate|capital corporation|bay area|midwest|the team)\b/gi, "")
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
};

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
        connection_request: z.string().nullable().optional(),
        email_message: z.string().nullable().optional(),
        linkedin_message: z.string().nullable().optional(),
        email_subject: z.string().nullable().optional(),
        email_body: z.string().nullable().optional(),
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
        icpId,
        manualDomains = [], // NEW: Manual Input Support
        runId
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
        if (!runId) return false; // Cannot check cancellation without runId
        try {
            const res = await query(`
                SELECT wr.status 
                FROM workflow_runs wr
                JOIN workflow_runs_link_table link ON wr.id = link.workflow_run_id
                WHERE wr.id = $1 AND link.parent_id = $2 AND link.parent_type = 'user'
            `, [runId, userId]);
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
    let companyContext = { name: null, goal: "Expand client base.", baselineTitles: [] };
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

                // Read Outreach Creator settings (NEW)
                if (cfg.surveys && cfg.surveys.outreach_creator) {
                    const outreach = cfg.surveys.outreach_creator;
                    if (outreach.template) companyContext.outreachTemplate = outreach.template;
                    if (outreach.forbidden) companyContext.outreachForbidden = outreach.forbidden;
                    if (outreach.credibility) companyContext.outreachCredibility = outreach.credibility;
                    if (outreach.facts_to_mention) companyContext.outreachFactsToMention = outreach.facts_to_mention;
                    if (outreach.channels) companyContext.outreachChannels = outreach.channels;
                    if (outreach.company_description) companyContext.companyDescription = outreach.company_description;
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
                // Capture used queries for diversification
                if (cfg.used_queries && Array.isArray(cfg.used_queries)) {
                    companyContext.usedQueries = cfg.used_queries;
                } else {
                    companyContext.usedQueries = [];
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
        const excludedDomains = await getExcludedDomains(userId);
        const normalizedExcludedNames = new Set(excludedNames.map(normalizeCompanyName).filter(Boolean));
        const leadScraper = new LeadScraperService();
        let masterQualifiedList = [];
        let totalDiscovered = 0;
        let totalDisqualified = 0;

        // --- NEW: Search Term Tracking for Logbook ---
        const searchStats = {
            terms_used: [],
            results_per_term: {},
            total_results: 0
        };

        // --- Phase 1: Discovery & Profiling with Rotating Search Terms ---
        // Initialize search terms if this ICP doesn't have any yet
        if (icpId) {
            const initResult = await initializeSearchTermsIfEmpty(icpId);
            if (initResult?.initialized) {
                logStep('Company Finder', `📋 Initialized search queue with ${initResult.count} terms (${initResult.source})`);
            } else if (initResult?.added > 0) {
                logStep('Company Finder', `📋 Synced ${initResult.added} new keywords from your approved list to the search queue.`);
            }
        }

        // Get ordered search terms (least recently used first)
        // Get ordered search terms (least recently used first)
        let searchTermQueue = icpId ? await getTermStrings(icpId) : [];

        // FALLBACK: If queue is empty (e.g. ad-hoc prompt or new ICP), generate terms now
        if (searchTermQueue.length === 0) {
            const promptForTerms = companyContext.icpDescription || input.input_as_text || "";
            if (promptForTerms) {
                logStep('Company Finder', `📋 No existing search terms found. Generating dynamically...`);
                const newTerms = await generateSearchTerms(promptForTerms, 10);
                searchTermQueue = newTerms;

                // If this is a real ICP, save them for next time
                if (icpId && newTerms.length > 0) {
                    await addSearchTerms(icpId, newTerms);
                    logStep('Company Finder', `💾 Saved ${newTerms.length} generated terms to ICP`);
                }
            }
        }
        let searchTermIndex = 0;
        const MAX_SEARCH_TERMS = 10; // Max terms to use in one run
        let termsUsedThisRun = [];

        logStep('Company Finder', `📋 Search term queue has ${searchTermQueue.length} terms. Starting discovery...`);

        // Loop through search terms until we hit target or exhaust terms
        // NEW: If manualDomains are provided, we SKIP the search loop and just use those
        const isManualMode = manualDomains && manualDomains.length > 0;

        let manualProcessed = false;

        while (masterQualifiedList.length < targetLeads) {
            if (await checkCancellation()) break;

            // Stop conditions
            if (isManualMode && manualProcessed) break;
            if (!isManualMode && (searchTermIndex >= searchTermQueue.length || searchTermIndex >= MAX_SEARCH_TERMS)) break;

            let candidates = [];

            if (isManualMode) {
                logStep('Company Finder', `📋 MANUAL MODE: Processing ${manualDomains.length} provided domains...`);
                candidates = manualDomains.map(d => ({
                    companyName: d,
                    company_name: d,
                    domain: d.toLowerCase().startsWith('http') ? d : `https://${d}`,
                    description: "Manual Entry"
                }));
                manualProcessed = true;
            } else {
                // --- AUTO SEARCH PATH ---
                const currentTerm = searchTermQueue[searchTermIndex];
                searchTermIndex++;
                termsUsedThisRun.push(currentTerm);

                // NEGATIVE KEYWORDS FOR FAMILY OFFICE RUNS
                // Reduces noise at source by excluding common false positives
                const isFamilyOfficeRun = (companyContext.icpDescription || "").toLowerCase().includes("family office") ||
                    (companyContext.name || "").toLowerCase().includes("family office");

                const negativeKeywords = isFamilyOfficeRun
                    ? ' -"wealth manager" -"financial advisor" -"wealth advisory" -"financial planning"'
                    : '';

                const enhancedSearchTerm = currentTerm + negativeKeywords;

                logStep('Company Finder', `🔍 Search Term ${searchTermIndex}/${Math.min(searchTermQueue.length, MAX_SEARCH_TERMS)}: "${currentTerm}"${negativeKeywords ? ' (with exclusions)' : ''}`);

                // 1. Run Apify Google Search (up to 100 results per term)
                let searchResults = [];
                try {
                    const { results, count } = await runGoogleSearch(enhancedSearchTerm, {
                        maxPagesPerQuery: 10, // 10 pages × 10 results = 100 max
                        countryCode: 'ca', // Default to Canada
                        checkCancellation
                    });
                    searchResults = results;

                    // Track for Logbook
                    searchStats.terms_used.push(currentTerm);
                    searchStats.results_per_term[currentTerm] = count;
                    searchStats.total_results += count;

                    logStep('Company Finder', `✅ Got ${count} results for "${currentTerm}"`);
                } catch (e) {
                    logStep('Company Finder', `❌ Search failed for "${currentTerm}": ${e.message}`);
                    continue; // Try next term
                }

                if (searchResults.length === 0) {
                    logStep('Company Finder', `⚠️ No results for "${currentTerm}", trying next term...`);
                    continue;
                }

                // 2. Filter ALL search results through AI in batches
                // Process in batches of 30 to fit in context window while using ALL 100 results
                const BATCH_SIZE = 30;
                let allCandidates = [];
                let listArticlesToScrape = []; // NEW: Track list articles separately
                let resultIndex = 0;

                while (resultIndex < searchResults.length) {
                    if (await checkCancellation()) break;

                    const batch = searchResults.slice(resultIndex, resultIndex + BATCH_SIZE);
                    resultIndex += BATCH_SIZE;

                    try {
                        logStep('Company Finder', `🔍 Filtering results ${resultIndex - BATCH_SIZE + 1}-${Math.min(resultIndex, searchResults.length)} of ${searchResults.length}...`);

                        const filterPrompt = `
    You are a company discovery agent. Analyze these search results and CATEGORIZE each one.

    ICP DESCRIPTION:
    "${companyContext.icpDescription || input.input_as_text}"

    STRICTNESS LEVEL: ${companyContext.strictness || 'Moderate'}
    EXCLUDED INDUSTRIES: ${companyContext.excludedIndustries || 'None'}
    MUST-HAVE CRITERIA: ${companyContext.keyAttributes || 'See ICP description'}

    SEARCH RESULTS (Batch ${Math.ceil(resultIndex / BATCH_SIZE)} of ${Math.ceil(searchResults.length / BATCH_SIZE)}):
    ${batch.map((r, i) => `${resultIndex - BATCH_SIZE + i + 1}. ${r.title}\n   URL: ${r.link}\n   Domain: ${r.domain}\n   Snippet: ${r.snippet}`).join('\n\n')}

    COMPANIES TO SKIP (already processed or in database):
    ${[
                                ...excludedNames.slice(0, 75),
                                ...masterQualifiedList.map(c => c.company_name).slice(0, 40),
                                ...allCandidates.map(c => c.companyName || c.company_name).slice(0, 40)
                            ].join(', ') || 'none yet'}

    DOMAINS TO SKIP:
    ${[...excludedDomains.slice(0, 50), ...allCandidates.map(c => c.domain).filter(Boolean).slice(0, 50)].join(', ')}

    CRITICAL DEDUPLICATION RULE:
    If a company name is a slight variation of one in the skip list (e.g., "Company Europe" vs "Company"), category it as "skip" unless it is explicitly a different entity type the user wants. We want to avoid noise.

    CATEGORIZE EACH RESULT INTO ONE OF THREE TYPES:

    1. "company" - Direct company website that matches or MIGHT match the ICP
       → Include companyName, domain, description

    2. "list" - A CURATED LIST ARTICLE (e.g., "Top 50 Real Estate Firms", "Best PE Funds in Canada")
       → These are VALUABLE! Include the URL so we can scrape the list and extract all companies from it
       → Include listUrl, listTitle, estimatedCompanies (your guess of how many companies are listed)

    3. "skip" - Job boards, news sites (not lists), government portals, stock exchanges, irrelevant content
       → Do not include in output

    OUTPUT JSON:
    {
      "companies": [{"companyName": "...", "domain": "...", "description": "..."}],
      "lists": [{"listUrl": "...", "listTitle": "...", "estimatedCompanies": 20}]
    }
    `;

                        const filterRes = await runGeminiAgent({
                            apiKey: googleKey,
                            modelName: 'gemini-2.0-flash',
                            agentName: 'Company Filter',
                            instructions: "You are a company discovery agent. Categorize search results into companies, valuable list articles, or skip. Output JSON only.",
                            userMessage: filterPrompt,
                            tools: [],
                            maxTurns: 1
                        });

                        costTracker.recordCall({
                            agent: 'Company Filter',
                            model: 'gemini-2.0-flash',
                            inputTokens: filterRes.usage?.inputTokens || 0,
                            outputTokens: filterRes.usage?.outputTokens || 0,
                            duration: 0,
                            success: true
                        });

                        // Parse with fallback for both old and new format
                        let parsed = {};
                        try {
                            const jsonMatch = filterRes.finalOutput.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                parsed = JSON.parse(jsonMatch[0]);
                            }
                        } catch (e) {
                            // Fallback to old schema if new format fails
                            const normalized = enforceAgentContract({
                                agentName: "Company Filter",
                                rawOutput: filterRes.finalOutput,
                                schema: CompanyFinderSchema
                            });
                            parsed = { companies: normalized.results || [], lists: [] };
                        }

                        const batchCompanies = (parsed.companies || parsed.results || [])
                            .filter(c => {
                                const name = c.company_name || c.companyName;
                                const normName = normalizeCompanyName(name);
                                const domain = (c.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();

                                // Aggressive Skip Check
                                const isDuplicateName = scrapedNamesSet.has(name) ||
                                    excludedNames.includes(name) ||
                                    [...normalizedExcludedNames].some(ex => normName.startsWith(ex) || ex.startsWith(normName));

                                const isDuplicateDomain = excludedDomains.some(exDomain => {
                                    const d = exDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
                                    return d && domain && (d === domain || d.endsWith('.' + domain) || domain.endsWith('.' + d));
                                }) || allCandidates.some(existing => {
                                    const d = (existing.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim();
                                    return d && domain && (d === domain || d.endsWith('.' + domain) || domain.endsWith('.' + d));
                                });

                                if (isDuplicateName || isDuplicateDomain) {
                                    // console.log(`[Discovery] ⏭️ Skipping variant: ${name} (${domain || 'no domain'})`);
                                    return false;
                                }
                                return true;
                            });

                        const batchLists = (parsed.lists || [])
                            .filter(l => l.listUrl && !listArticlesToScrape.some(existing => existing.listUrl === l.listUrl));

                        allCandidates.push(...batchCompanies);
                        listArticlesToScrape.push(...batchLists);

                        logStep('Company Finder', `📋 Batch: ${batchCompanies.length} companies, ${batchLists.length} list articles (Total: ${allCandidates.length} companies, ${listArticlesToScrape.length} lists)`);

                    } catch (e) {
                        logStep('Company Finder', `⚠️ Batch filter failed: ${e.message}`);
                    }
                }

                // 2b. NEW: Extract companies from list articles
                const MAX_LISTS_TO_SCRAPE = 3; // Limit to prevent runaway costs
                if (listArticlesToScrape.length > 0) {
                    logStep('Company Finder', `📰 Found ${listArticlesToScrape.length} list articles to mine for companies...`);

                    for (const listArticle of listArticlesToScrape.slice(0, MAX_LISTS_TO_SCRAPE)) {
                        if (await checkCancellation()) break;

                        try {
                            logStep('Company Finder', `🔗 Scraping list: "${listArticle.listTitle}"...`);

                            // Scrape the list page
                            const { content: listContent } = await scrapeWebsiteSmart(listArticle.listUrl);

                            if (!listContent || listContent.length < 200) {
                                logStep('Company Finder', `⚠️ Could not scrape list page, skipping`);
                                continue;
                            }

                            // Extract companies from the list content
                            const extractPrompt = `
    You scraped a list article titled "${listArticle.listTitle}".
    Extract ALL companies mentioned with their domains (if available).

    LIST CONTENT:
    ${(listContent || '').slice(0, 20000)}

    ICP CRITERIA TO MATCH:
    "${companyContext.icpDescription || input.input_as_text}"

    COMPANIES TO SKIP (already have):
    ${[...scrapedNamesSet, ...allCandidates.map(c => c.companyName || c.company_name)].slice(0, 50).join(', ')}

    TASK:
    1. Extract company names and domains from this list
    2. Only include companies that MIGHT match the ICP
    3. If domain is not visible, try to infer it (e.g., "ABC Capital" → "abccapital.com")

    OUTPUT JSON:
    {"companies": [{"companyName": "...", "domain": "...", "description": "From list: ${listArticle.listTitle}"}]}
    `;

                            const extractRes = await runGeminiAgent({
                                apiKey: googleKey,
                                modelName: 'gemini-2.0-flash',
                                agentName: 'List Extractor',
                                instructions: "Extract company names and domains from a curated list article. Output JSON only.",
                                userMessage: extractPrompt,
                                tools: [],
                                maxTurns: 1
                            });

                            costTracker.recordCall({
                                agent: 'List Extractor',
                                model: 'gemini-2.0-flash',
                                inputTokens: extractRes.usage?.inputTokens || 0,
                                outputTokens: extractRes.usage?.outputTokens || 0,
                                duration: 0,
                                success: true
                            });

                            let extracted = [];
                            try {
                                const jsonMatch = extractRes.finalOutput.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    const parsed = JSON.parse(jsonMatch[0]);
                                    extracted = parsed.companies || [];
                                }
                            } catch (e) {
                                logStep('Company Finder', `⚠️ Failed to parse list extraction`);
                            }

                            // Filter and add to candidates
                            const newFromList = extracted
                                .filter(c => c.companyName && c.domain)
                                .filter(c => !scrapedNamesSet.has(c.companyName))
                                .filter(c => !allCandidates.some(existing =>
                                    (existing.domain || '').toLowerCase() === (c.domain || '').toLowerCase()));

                            allCandidates.push(...newFromList);
                            logStep('Company Finder', `✅ Extracted ${newFromList.length} NEW companies from "${listArticle.listTitle}"`);

                        } catch (e) {
                            logStep('Company Finder', `⚠️ List scraping failed for "${listArticle.listTitle}": ${e.message}`);
                        }
                    }
                }

                // Now we have ALL candidates from this search term
                candidates = allCandidates;
                totalDiscovered += candidates.length;
                logStep('Company Finder', `📊 Total ${candidates.length} candidate companies from "${currentTerm}" (processed all ${searchResults.length} results)`);

                if (candidates.length === 0) {
                    logStep('Company Finder', `⚠️ No new candidates from "${currentTerm}", trying next term...`);
                    continue;
                }
            } // END ELSE (Auto Search Path)

            // --- COMMON: PROCESSING CANDIDATES (For both Manual and Auto) ---
            // 'candidates' is now populated with domains to profile

            // 3. Profile each candidate (existing profiling logic)
            const apifyToken = process.env.APIFY_API_TOKEN;
            const batchResults = [];

            for (const candidate of candidates) {
                if (await checkCancellation()) break;
                if (masterQualifiedList.length >= targetLeads) {
                    logStep('Company Finder', `🎯 Target of ${targetLeads} qualified companies reached!`);
                    break;
                }

                try {
                    logStep('Company Profiler', `Analyzing ${candidate.companyName || candidate.company_name} (${candidate.domain})...`);

                    // 3a. SMART SCRAPING
                    let finalContent = "";
                    try {
                        const { links, content: fallbackContent } = await scrapeWebsiteSmart(candidate.domain);
                        finalContent = fallbackContent;

                        if (companyContext.depth === "Deep Dive (News, LinkedIn, Reports)" && links.length > 5) {
                            logStep('Company Profiler', `🧠 Smart Selecting pages for ${candidate.domain}...`);
                            const bestUrls = await selectRelevantPages(candidate.domain, links, companyContext.icpDescription);
                            if (bestUrls.length > 0) {
                                finalContent = await scrapeSpecificPages(bestUrls, apifyToken, checkCancellation);
                            }
                        }
                    } catch (scrapeErr) {
                        console.warn("Smart scraping failed, falling back to empty content", scrapeErr);
                        finalContent = "Error scraping website.";
                    }

                    // 3b. GENERATE PROFILE
                    const isFamilyOfficeSearch = (companyContext.icpDescription || "").toLowerCase().includes("family office") ||
                        (companyContext.name || "").toLowerCase().includes("family office");

                    const isInvestmentFirmSearch = (companyContext.icpDescription || "").toLowerCase().includes("investment firm") ||
                        (companyContext.icpDescription || "").toLowerCase().includes("investment fund") ||
                        (companyContext.name || "").toLowerCase().includes("investment");

                    // PARAMETERIZED SCORE THRESHOLD PER ICP TYPE
                    const scoreThreshold = isFamilyOfficeSearch ? 8 : 6;

                    let strictnessInstructions = "";
                    if (isFamilyOfficeSearch) {
                        strictnessInstructions = `
                        CRITICAL FAMILY OFFICE VALIDATION:
                        The user is looking for SINGLE FAMILY OFFICES (SFO) or MULTI-FAMILY OFFICES (MFO) that invest DIRECTLY.
                        
                        YOU MUST DISQUALIFY (Score 1-3) IF THEY ARE:
                        - A Wealth Manager / Financial Advisor (unless they explicitly state a DIRECT Real Estate investment arm with PROPRIETARY CAPITAL).
                        - A Broker / Intermediary / Capital Advisory / Investment Sales Firm (e.g. Marcus & Millichap, CBRE, JLL, Colliers).
                        - A Real Estate Agency (buying/selling individual homes, luxury estates, vineyards, yachts).
                        - An Investment Bank.
                        - A General Private Equity fund (unless specific to a family or HNWIs).
                        - A "Multi-Client Family Office" that just provides services (tax, legal, lifestyle) without a direct investment fund.
                        
                        ONLY SCORE 8+ IF:
                        - They explicitly identify as a Family Office.
                        - OR they use language like "proprietary capital", "family capital", "private investment vehicle", "evergreen capital".
                        - OR they allow direct deals (not just allocating to funds).`;
                    } else if (isInvestmentFirmSearch) {
                        strictnessInstructions = `
                        CRITICAL INVESTMENT FIRM VALIDATION:
                        The user is looking for REAL ESTATE INVESTMENT FIRMS, PRIVATE EQUITY FIRMS, or INSTITUTIONAL INVESTORS that INVEST in Real Estate.
                        
                        YOU MUST DISQUALIFY (Score 1-3) IF THEY ARE:
                        - A Pure Broker / Sales-Only Firm (they don't invest, they just transact/advise).
                        - Signals of Brokerage: "Investment Sales", "Capital Markets Advisory", "Debt Placement", "Structuring", "Closing $X in volume", "Representing sellers".
                        - A Service Provider (Law, Tax, Consulting, HR, Marketing).
                        - A Lender (Debt-only, no equity positions).
                        - A Tenant / Occupier (they lease space, don't invest).
                        - A Construction / Development Services Company (Builder, Contractor, Architect).
                        
                        SCORE 6+ IF:
                        - They are a Private Equity / Venture firm with Real Estate as a vertical.
                        - They are a REIT, Asset Manager, or Pension Fund with RE holdings.
                        - They are a "Holdings" or "Group" company with investment mandates.
                        - They mention "Acquisitions", "Capital Deployment", "Portfolio Companies", "Equity Partner". 
                        - NOTE: Do NOT score high just for "AUM" if they are a pure manager/advisor. They must own/deploy equity.`;
                    }

                    // NEW: GEOGRAPHY CHECK
                    const isCanadaRequired = (companyContext.icpDescription || "").toLowerCase().includes("canada") ||
                        (companyContext.icpDescription || "").toLowerCase().includes("canadian");

                    if (isCanadaRequired) {
                        strictnessInstructions += `
                        
                        CRITICAL GEOGRAPHY CHECK (CANADA):
                        The user STRICTLY requires companies based in CANADA or with a MAJOR CANADIAN PRESENCE.
                        - IF the company is clearly based in the US, UK, India, Middle East, etc. WITHOUT a Canadian office or explicit mention of Canadian investments -> DISQUALIFY IMMEDIATELY (Score 1).
                        - IF the company is Global, they are ONLY permitted if they mention a "Toronto" or "Vancouver" or "Montreal" office OR explicitly state they are "actively investing in Canada". Otherwise -> DISQUALIFY.
                        `;
                    }

                    // NEW: INFRASTRUCTURE / OPERATING CO EXCLUSION
                    strictnessInstructions += `
                    
                    SECTOR EXCLUSIONS:
                    - IF the company is primarily an "Infrastructure Fund", "Energy Investor", or "Operating Company" (non-real estate) -> DISQUALIFY (Score 2) unless Real Estate is explicitly a major vertical.
                    `;


                    const profilePrompt = `
                        I have scraped the website of ${candidate.companyName || candidate.company_name} (${candidate.domain}).
                        
                        WEBSITE CONTENT:
                        ${(finalContent || "").slice(0, 25000)} 
                        
                        YOUR TASK:
                        Analyze this content and create a detailed Company Profile JSON.
                        
                        ${strictnessInstructions}
                        
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
                        {"results": [{"company_name": "${candidate.companyName || candidate.company_name}", "domain": "${candidate.domain}", "company_profile": "...", "match_score": 8}]}
                        `;

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

                    // Filter by score (using parameterized threshold)
                    for (const company of analyzed) {
                        const isHighQuality = (company.match_score || 0) >= scoreThreshold;
                        if (isHighQuality) {
                            masterQualifiedList.push(company);
                            scrapedNamesSet.add(company.company_name);
                            logStep('Company Profiler', `✅ Qualified: ${company.company_name} (Score: ${company.match_score}/10, Threshold: ${scoreThreshold})`);
                        } else {
                            totalDisqualified++;
                            logStep('Company Profiler', `🗑️ Dropped: ${company.company_name} (Score: ${company.match_score}/10, Threshold: ${scoreThreshold})`);
                        }
                    }

                } catch (err) {
                    logStep('Company Profiler', `Failed to analyze ${candidate.companyName || candidate.company_name}: ${err.message}`);
                }
            }

            logStep('Company Finder', `📈 Progress: ${masterQualifiedList.length}/${targetLeads} qualified companies`);
        }

        // --- Rotate used search terms to back of queue ---
        if (icpId && termsUsedThisRun.length > 0) {
            try {
                await markTermsAsUsed(icpId, termsUsedThisRun, searchStats.results_per_term);
                logStep('System', `🔄 Rotated ${termsUsedThisRun.length} search terms to back of queue`);
            } catch (e) {
                console.error('Failed to rotate search terms:', e.message);
            }
        }

        logStep('Company Finder', `✅ Discovery complete: ${masterQualifiedList.length} qualified, ${totalDisqualified} disqualified, ${totalDiscovered} total discovered`);

        // --- Phase 1 Check: Data Starvation Protection ---
        if (masterQualifiedList.length === 0) {
            logStep('Workflow', '❌ No qualified companies found after discovery. Stopping workflow to prevent hallucination.');
            return {
                status: 'failed',
                leads: [],
                stats: { total: 0, searchStats, cost: costTracker.getSummary() },
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
                        stats: { total: 0, searchStats, cost: costTracker.getSummary() },
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
                    instructions: `You are Roelof van Heeren, a Principal at Fifth Avenue Properties, a Canadian residential real estate development firm.
Your goal is to write direct, fact-based outreach messages to potential Investment Partners (LPs/Co-GPs) or Peers in the industry.

CRITICAL: The user HATES generic messages. 
- NEVER use "Assets Under Management" (AUM) as the hook.
- NEVER use "Number of Offices" or "Transaction Volume" as the hook.
- NEVER mention "Sales Volume" (that sounds like a brokerage).

HARD LIMITS (CRITICAL):
- LinkedIn Message Max Length: 300 characters (Strictly enforced).
- Mention EXACTLY ONE researched fact from the company profile.
- Mention COMPANY FACTS ONLY (No personal details, no "20 years experience").
- NO FLATTERY (No "Impressive career", "Great work").
- NO BUZZWORDS (No "synergies", "unlock value", "disrupting").
- NO CALLS TO ACTION (No "hop on a call", no "meeting").
- MAXIMUM GENERALITY RULE: Prefer specific facts, but if none are found, use a general professional statement about their residential focus. DO NOT FAIL.

MANDATORY PRIORITY ORDER (Stop at the FIRST match):

1. SPECIFIC DEALS / NAMED PROJECTS (Highest Priority)
   - Fact: A specific project name, asset, or recent acquisition.
   - Alignment Line: "We frequently develop similar projects at Fifth Avenue Properties" OR "We develop similar residential projects at Fifth Avenue Properties"
   - Example: "Hi Sarah, I came across Alpine Start’s Alpine Village project in North Texas. We frequently develop similar projects at Fifth Avenue Properties and thought connecting could be worthwhile."

2. INVESTMENT THESIS / STRATEGY (Focus on ASSET CLASS)
   - Fact: Specific strategy like "ground-up multifamily", "purpose-built rental", "residential-led mixed use".
   - Alignment Line: "We work on similar residential strategies at Fifth Avenue Properties"
   - Example: "Hi Michael, I came across Morguard’s long-standing focus on multi-suite residential across North America. We work on similar residential strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

3. RESIDENTIAL FOCUS / MARKET PRESENCE
   - Fact: A clear statement of residential focus (e.g. "Owning 50,000 apartments", "Developing master-planned communities").
   - DO NOT USE AUM or GENERIC SCALE ("$5B AUM"). Use unit count or specific market presence if available.
   - Alignment Line: "We focus on similar residential markets at Fifth Avenue Properties"
   - Example: "Hi John, I noticed Choice Properties' significant portfolio of residential assets in major Canadian markets. We focus on similar residential development strategies at Fifth Avenue Properties and thought connecting could be worthwhile."

BAD FACTS (DO NOT USE THESE):
- "Closed $700M in sales" -> REJECT (Brokerage signal).
- "45 offices worldwide" -> REJECT (Generic).
- "$4.1B AUM" -> REJECT (Unless tied to specific "residential assets").
- "Advice on vineyards" -> REJECT (Irrelevant).

LINKEDIN MESSAGE STRUCTURE (Fixed):
Sentence 1: Greeting + Researched Company Fact (e.g. "Hi [Name], I came across [Company] and [Specific Fact].")
Sentence 2: Fifth Avenue Properties alignment (Use mandatory alignment line from above) + Soft close ("and thought connecting could be worthwhile.")

EMAIL STRUCTURE:
Subject: Introduction | [Specific Asset Class/Strategy]
Body:
"Hi [Name],

I came across [Company] and your [Specific Fact used in LinkedIn msg].

At Fifth Avenue Properties, [Alignment Line used in LinkedIn msg], which is why I thought it could make sense to connect.

If it makes sense, I'm happy to share more information about our current projects.

Best regards,
Roelof van Heeren
Fifth Avenue Properties"

OUTPUT JSON:
{ "leads": [{ "email": "...", "connection_request": "...", "email_subject": "...", "email_message": "..." }] }
If no specific fact is found, craft a polite, relevant generic message about their residential investment focus. NEVER return null.`,
                    userMessage: `Draft outreach for these leads based on their 'company_profile' (Intelligence Report).
Strictly follow the Priority Order and Hard Limits.

LEADS:
${JSON.stringify(batch.map(l => ({
                        email: l.email,
                        first_name: l.first_name,
                        company_name: l.company_name,
                        title: l.title,
                        company_profile: (l.company_profile || "").substring(0, 3000)
                    })))}`,
                    tools: [],
                    maxTurns: 1,
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
        await saveLeadsToDB(finalLeads, userId, icpId, logStep, 'NEW', runId);

        return {
            status: finalLeads.length >= targetLeads ? 'success' : 'partial',
            leads: finalLeads,
            stats: {
                leads_returned: finalLeads.length,
                qualified: finalLeads.length,
                leadsDisqualified: totalDisqualified,
                companies_discovered: masterQualifiedList.length,
                searchStats,
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
 * CRM Admission Gate - Validates a lead before persistence
 * @returns {{ pass: boolean, reason?: string }}
 */
const validateLeadForCRM = (lead, status) => {
    // Rule 1: Must have email (Required for all leads to avoid DB chaos)
    if (!lead.email) return { pass: false, reason: 'Missing email' };

    // DISQUALIFIED leads pass easily for review
    if (status === 'DISQUALIFIED') return { pass: true };

    // Rule 2: Email domain must not be generic/fake
    const emailDomain = lead.email.split('@')[1]?.toLowerCase();
    const BLOCKED_DOMAINS = [
        'linktr.ee', 'linktree.com', 'example.com', 'test.com',
        'temp-mail.org', 'mailinator.com', 'guerrillamail.com',
        'bio.link', 'beacons.ai', 'stan.store', 'carrd.co'
    ];
    if (!emailDomain || BLOCKED_DOMAINS.includes(emailDomain)) {
        return { pass: false, reason: `Blocked email domain: ${emailDomain || 'missing'}` };
    }

    // Rule 3: Must have company_name
    if (!lead.company_name || lead.company_name.trim() === '' || lead.company_name === 'Unknown') {
        return { pass: false, reason: 'Missing or invalid company_name' };
    }

    // Rule 4: For NEW status, warn if missing outreach but DO NOT REJECT
    if (status === 'NEW') {
        if (!lead.connection_request && !lead.email_message && !lead.email_body) {
            // Changed logic: Allow passing but log it
            // return { pass: false, reason: 'Missing outreach messages (required for NEW status)' };
            /* Allow it to pass so user can manually review */
        }
    }

    // Rule 5: Must have some company association data
    if (!lead.company_profile && !lead.company_website && !lead.company_domain) {
        return { pass: false, reason: 'No company association data' };
    }

    return { pass: true };
};

/**
 * DB Persistence with CRM Admission Gate
 */
export const saveLeadsToDB = async (leads, userId, icpId, logStep, forceStatus = 'NEW', runId = null) => {
    if (!leads || leads.length === 0) return;

    let savedCount = 0;
    let redirectedCount = 0;
    let rejectedCount = 0;

    for (const lead of leads) {
        try {
            // === CRM ADMISSION GATE ===
            let currentStatus = forceStatus;
            const gateResult = validateLeadForCRM(lead, currentStatus);

            if (!gateResult.pass) {
                // If this was meant to be a NEW lead, redirect to DISQUALIFIED for review
                if (currentStatus === 'NEW') {
                    currentStatus = 'DISQUALIFIED';
                    lead.disqualification_reason = `REJECTED AT GATE: ${gateResult.reason}`;
                    redirectedCount++;
                    // Fall through to save... 
                } else {
                    // If it's already meant to be disqualified and still fails (no email), drop it
                    console.log(`[CRM Gate] ❌ Dropped ${lead.first_name} ${lead.last_name} (${lead.email || 'no email'}): ${gateResult.reason}`);
                    rejectedCount++;
                    continue;
                }
            }

            // Removed redundant existence check to allow ON CONFLICT UPDATE to work for existing leads
            // This ensures enrichment data is saved even if the lead is already linked to the user

            const insertRes = await query(`INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, source, user_id, icp_id, custom_data, run_id, 
                        company_website, company_domain, match_score, email_message, email_body, email_subject, linkedin_message, connection_request, disqualification_reason)
                        VALUES($1, $2, $3, $4, $5, $6, 'Outbound Agent', $7, $8, $9, $10, 
                        $11, $12, $13, $14, $15, $16, $17, $18, $19) 
                        ON CONFLICT (email) DO UPDATE SET
                            company_name = EXCLUDED.company_name,
                            person_name = EXCLUDED.person_name,
                            job_title = EXCLUDED.job_title,
                            linkedin_url = EXCLUDED.linkedin_url,
                            status = EXCLUDED.status,
                            icp_id = EXCLUDED.icp_id,
                            custom_data = EXCLUDED.custom_data,
                            run_id = EXCLUDED.run_id,
                            company_website = EXCLUDED.company_website,
                            company_domain = EXCLUDED.company_domain,
                            match_score = EXCLUDED.match_score,
                            email_message = EXCLUDED.email_message,
                            email_body = EXCLUDED.email_body,
                            email_subject = EXCLUDED.email_subject,
                            linkedin_message = EXCLUDED.linkedin_message,
                            connection_request = EXCLUDED.connection_request,
                            disqualification_reason = EXCLUDED.disqualification_reason,
                            updated_at = NOW()
                        RETURNING id`,
                [
                    lead.company_name,
                    `${lead.first_name} ${lead.last_name}`.trim(),
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    currentStatus,
                    userId,
                    icpId || null, // Sanitize empty string to null for UUID
                    {
                        icp_id: icpId,
                        score: lead.match_score,
                        company_profile: lead.company_profile,
                        company_website: lead.company_website || lead.company_domain,
                        company_domain: lead.company_domain,
                        email_message: lead.email_message || lead.email_body,
                        email_subject: lead.email_subject,
                        connection_request: lead.connection_request,
                        disqualification_reason: lead.disqualification_reason
                    },
                    runId || null, // Sanitize empty string to null for UUID
                    // Direct columns for easier querying
                    lead.company_website || lead.company_domain,
                    lead.company_domain,
                    lead.match_score,
                    lead.email_message,
                    lead.email_body,
                    lead.email_subject,
                    lead.linkedin_message, // Assuming this is where connection request msg might be stored if different
                    lead.connection_request,
                    lead.disqualification_reason
                ]);

            const leadId = insertRes.rows[0].id;

            await query(
                `INSERT INTO leads_link(lead_id, parent_id, parent_type) 
                 VALUES($1, $2, 'user') 
                 ON CONFLICT DO NOTHING`,
                [leadId, userId]
            );

            savedCount++;
        } catch (e) {
            console.error('Failed to save lead:', e.message);
        }
    }

    if (savedCount > 0 || redirectedCount > 0 || rejectedCount > 0) {
        const typeLabel = (forceStatus === 'DISQUALIFIED') ? '❌ Disqualified' : '✅ Valid';
        let detailMsg = `Saved ${savedCount} leads.`;
        if (redirectedCount > 0) detailMsg += ` Redirected ${redirectedCount} to disqualified for review.`;
        if (rejectedCount > 0) detailMsg += ` Dropped ${rejectedCount} (dead data).`;

        logStep('Database', `${typeLabel} Sync: ${detailMsg}`);
    }

    // SYNC: Mark companies as researched to prevent discovery in future runs AND Sync to companies table
    if (savedCount > 0) {
        try {
            const savedLeads = leads.filter(l => validateLeadForCRM(l, forceStatus).pass);

            // 1. Mark as Researched
            const { markCompaniesAsResearched } = await import('./company-tracker.js');
            const companiesToMark = [...new Set(savedLeads.map(l => l.company_name))].map(name => {
                const lead = savedLeads.find(l => l.company_name === name);
                return {
                    name,
                    domain: lead.company_website || lead.company_domain || lead.domain,
                    leadCount: savedLeads.filter(l => l.company_name === name).length,
                    metadata: { source: 'workflow_save', icp_id: icpId }
                };
            });
            await markCompaniesAsResearched(userId, companiesToMark);

            // 2. Sync to Display Table (companies)
            const uniqueCompanies = [...new Set(savedLeads.map(l => l.company_name))];
            for (const name of uniqueCompanies) {
                const lead = savedLeads.find(l => l.company_name === name);
                const finalWebsite = lead.company_website || lead.company_domain || lead.domain;

                // CRITICAL FIX: Use company_fit_score (from Company Profiler), NOT lead.match_score (from Lead Ranker)
                // lead.match_score = how good the PERSON is (1-10 based on job title)
                // company_fit_score = how good the COMPANY is (1-10 based on ICP fit)
                let score = parseInt(lead.company_fit_score);
                if (isNaN(score)) score = null;

                await query(`
                    INSERT INTO companies (user_id, company_name, website, company_profile, fit_score, created_at, last_updated)
                    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    ON CONFLICT (user_id, company_name) 
                    DO UPDATE SET
                        website = COALESCE(companies.website, EXCLUDED.website),
                        company_profile = COALESCE(companies.company_profile, EXCLUDED.company_profile),
                        fit_score = COALESCE(companies.fit_score, EXCLUDED.fit_score),
                        last_updated = NOW()
                `, [userId, name, finalWebsite, lead.company_profile, score]);
            }

        } catch (e) {
            console.error('Failed to sync with researched_companies/companies:', e.message);
        }
    }
};

/**
 * Manual Enrichment (Helper)
 */
export const enrichLeadWithPhone = async (lead) => {
    return [];
};
