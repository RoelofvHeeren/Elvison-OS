import axios from 'axios';
import { GeminiModel } from "./gemini.js";
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APIFY_API_URL = 'https://api.apify.com/v2';

// ... (previous helper functions buildPipelineLabsPayload, startApifyScrape, checkApifyRun, getApifyResults remain unchanged) ...



/**
 * Checks the status of a run
 * @param {string} token 
 * @param {string} runId 
 * @returns {Promise<Object>} - { status, datasetId }
 */
export const checkApifyRun = async (token, runId) => {
    try {
        const response = await axios.get(
            `${APIFY_API_URL}/actor-runs/${runId}?token=${token}`
        );
        const { status, defaultDatasetId } = response.data.data;
        return { status, datasetId: defaultDatasetId };
    } catch (error) {
        console.error('Apify Check Error:', error.response?.data || error.message);
        throw new Error('Failed to check run status');
    }
};

/**
 * Aborts a running Apify job
 * @param {string} token 
 * @param {string} runId 
 */
export const abortApifyRun = async (token, runId) => {
    try {
        console.log(`[Apify] Aborting Run ${runId}...`);
        await axios.post(
            `${APIFY_API_URL}/actor-runs/${runId}/abort?token=${token}`
        );
        return true;
    } catch (error) {
        console.error('Apify Abort Error:', error.response?.data || error.message);
        return false;
    }
};

/**
 * Fetches results from the dataset with pagination support
 * @param {string} token 
 * @param {string} datasetId 
 * @param {number} offset - starting position
 * @param {number} limit - max items to fetch
 * @returns {Promise<Array>} - Array of results
 */
export const getApifyResults = async (token, datasetId, offset = 0, limit = 1000) => {
    try {
        const response = await axios.get(
            `${APIFY_API_URL}/datasets/${datasetId}/items?token=${token}&offset=${offset}&limit=${limit}`
        );
        return response.data;
    } catch (error) {
        console.error('Apify Result Error:', error.response?.data || error.message);
        throw new Error('Failed to fetch results');
    }
};

/**
 * Fetches dataset metadata (to get itemCount)
 */
export const getDatasetInfo = async (token, datasetId) => {
    try {
        const response = await axios.get(
            `${APIFY_API_URL}/datasets/${datasetId}?token=${token}`
        );
        return response.data.data;
    } catch (error) {
        console.error('Apify Dataset Info Error:', error.response?.data || error.message);
        return null;
    }
};

// =============================================================================
// NEW: Leads Scraper (Emails guaranteed - Rental) (Actor ID: GlxYrQp6f3YAzH2W2)
// Cost: $35/month flat fee for 300k leads (Rental Plan)
// =============================================================================

/**
 * Constructs the payload for the Leads Scraper Actor
 * @param {Array<string>} domains - List of company domains (e.g., "greybrook.com")
 * @param {Object} filters - Dynamic filters
 * @returns {Object} - The constructed payload
 */
export const buildApolloDomainPayload = (domains, filters = {}) => {
    // Strict titles - Only C-level and senior decision makers (Real Estate/Investment focus)
    const defaultTitles = [
        "CEO", "President", "Managing Director", "Principal",
        "Founder", "Co-Founder", "Managing Partner", "Partner",
        "CIO", "COO", "CFO",
        "Executive Vice President", "Executive Director",
        "Director of Investments", "Director of Developments"
    ];

    // Strict seniorities - C-level and Executives only
    const defaultSeniorities = [
        "Founder", "Chairman", "President", "CEO", "CXO",
        "Vice President", "Director"
    ];

    // Clean domains - ensure no http/https prefix and deduplicate
    const cleanDomains = [...new Set(
        domains.map(d => {
            if (!d) return null;
            return d.replace(/^https?:\/\//, '').replace(/^www\./, '').trim().toLowerCase();
        }).filter(Boolean)
    )];

    // MAPPING: Convert user-friendly labels to valid Apify/Apollo values
    // ALLOWED SENIORITY: "Founder", "Chairman", "President", "CEO", "CXO", "Vice President", "Director", "Head", "Manager", "Senior", "Junior", "Entry Level", "Executive"
    let mappedSeniority = filters.seniority;
    if (filters.seniority && filters.seniority.length > 0) {
        mappedSeniority = filters.seniority.flatMap(s => {
            if (s === "Partner / Principal") return ["Executive", "Director"];
            if (s === "C-Level (CEO, CIO, COO)") return ["CXO", "CEO", "President", "Founder"];
            if (s === "Managing Director") return ["Director", "Head"];
            if (s === "VP / Director") return ["Vice President", "Director"];
            if (s === "Head of X") return ["Head"];
            if (s === "Manager / Associate") return ["Manager", "Senior"];
            if (s === "Partner" || s === "Principal" || s === "Owner") return ["Executive", "Founder"];
            return s;
        });

        const ALLOWED_VALUES = ["Founder", "Chairman", "President", "CEO", "CXO", "Vice President", "Director", "Head", "Manager", "Senior", "Junior", "Entry Level", "Executive"];
        mappedSeniority = mappedSeniority.filter(s => ALLOWED_VALUES.includes(s));
        mappedSeniority = [...new Set(mappedSeniority)];
    }

    // MAPPING: Employee Size to specific ranges
    // Allowed: "0 - 1", "2 - 10", "11 - 50", "51 - 200", "201 - 500", "501 - 1000", "1001 - 5000", "5001 - 10000", "10000+"
    // We map generic buckets to these specific ones
    const sizeMapping = [
        "11 - 50", "51 - 200", "201 - 500", "501 - 1000",
        "1001 - 5000", "5001 - 10000", "10000+"
    ];

    // MAPPING: Job Functions (App UI -> Apify Actor Keys)
    let mappedFunctions = filters.job_functions || [];
    if (mappedFunctions.length > 0) {
        mappedFunctions = mappedFunctions.flatMap(f => {
            if (f === "Executive / Leadership") return ["Executive", "Management", "Administration"];
            if (f === "Sales / Revenue") return ["Sales", "Business Development"];
            if (f === "Marketing / Growth") return ["Marketing", "Branding"];
            if (f === "Product / Engineering") return ["Product", "Engineering"];
            if (f === "Operations") return ["Operations", "Administrative"];
            if (f === "Finance") return ["Finance", "Accounting"];
            if (f === "HR / People") return ["Human Resources", "Recruiting"];
            if (f === "Legal") return ["Legal"];
            return f; // Pass through if no match (e.g. manual entry)
        });
        mappedFunctions = [...new Set(mappedFunctions)];
    }

    const payload = {
        // Domain Filters - "Shotgun" approach to hit correct actor parameter
        companyDomain: cleanDomains,       // MATCHED USER SUCCESS INPUT (Singular)
        companyDomains: cleanDomains,      // Plural (Legacy/safety)
        organizationDomains: cleanDomains, // Common alias
        qOrganizationDomains: cleanDomains.join('\n'), // Apollo URL format (newline separated)

        // Person Filters
        personTitle: (filters.job_titles && filters.job_titles.length > 0) ? filters.job_titles : defaultTitles,
        seniority: (mappedSeniority && mappedSeniority.length > 0) ? mappedSeniority : defaultSeniorities,

        // STRICT Department Filters - Only applied if NOT in lenient mode
        departments: filters.lenientMode ? [] : [
            "master_c_suite",
            "master_executive",
            "master_operations",
            "master_finance"
        ],

        // EXPLICIT Department Exclusions - Only applied if NOT in lenient mode
        departmentsExclude: filters.lenientMode ? [] : [
            "master_marketing",
            "master_engineering_technical",
            "master_sales",
            "master_human_resources",
            "master_support",
            "master_information_technology",
            "master_media_communications"
        ],

        // EXPLICIT Title Exclusions - Only applied if NOT in lenient mode
        personTitlesExclude: filters.lenientMode ? [] : [
            "VP of Marketing", "Head of Marketing", "CMO", "Chief Marketing Officer",
            "VP of Engineering", "Head of Engineering", "CTO", "Chief Technology Officer",
            "VP of Sales", "Head of Sales", "Chief Revenue Officer",
            "VP of HR", "Head of HR", "CHRO", "Chief Human Resources Officer",
            "VP of IT", "Head of IT", "CIO", // Note: We want investment CIOs, but IT CIOs slip through
            "Software Engineer", "Developer", "Marketing Manager", "Sales Manager",
            "HR Manager", "IT Manager", "Support Manager"
        ],

        // Email Settings
        contactEmailStatus: "verified", // Strict verification
        includeEmails: true,
        skipLeadsWithoutEmails: true,

        // Limits - Dynamic based on batch size (30 per company)
        // filters.maxLeads is set by lead-scraper-service to domains.length * 30
        totalResults: filters.maxLeads || 300 // Fallback to 300 if not set
    };

    // STRICT MODE: If domains are provided, do NOT send broad filters (Country/Employee Size)
    // This prevents the "OR" logic in Apify that returns random companies in the target country
    if (cleanDomains.length > 0) {
        console.log(`[ApolloDomain] 🔒 STRICT MODE: Omitting country/size filters to enforce valid domain matches.`);
    } else {
        // Only valid if we were doing a broad search (which this function isn't really for, but as fallback)
        payload.companyCountry = filters.countries || filters.geography || ["United States", "Canada"];
        payload.companyEmployeeSize = sizeMapping;
    }

    return payload;
};

/**
 * Starts the Leads Scraper Actor (Rental)
 * @param {string} token - Apify API Token
 * @param {Array<string>} domains - List of company domains
 * @param {Object} filters - Dynamic filters
 * @returns {Promise<string>} - The Run ID
 */
export const startApolloDomainScrape = async (token, domains, filters = {}, idempotencyKey = null) => {
    try {
        if (!domains || domains.length === 0) {
            console.warn("[ApolloDomain] No domains provided.");
            return null;
        }

        const input = buildApolloDomainPayload(domains, filters);
        console.log(`[ApolloDomain] Starting scrape for ${domains.length} domains...`);

        // Leads Scraper (Emails guaranteed - Rental)
        const ACTOR_ID = 'GlxYrQp6f3YAzH2W2';

        console.log(`[ApolloDomain] Sending payload to ${ACTOR_ID}:`, JSON.stringify(input, null, 2));

        // URL construction with optional idempotencyKey
        let url = `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`;
        if (idempotencyKey) {
            url += `&idempotencyKey=${idempotencyKey}`;
            console.log(`[ApolloDomain] Using idempotencyKey: ${idempotencyKey}`);
        }

        const response = await axios.post(
            url,
            input,
            { headers: { 'Content-Type': 'application/json' } }
        );

        console.log(`[ApolloDomain] Scrape started. Run ID: ${response.data.data.id}`);
        return response.data.data.id;
    } catch (error) {
        console.error('[ApolloDomain] Start Error:', error.response?.data || error.message);
        throw new Error(`Failed to start Lead Scrape: ${error.response?.data?.error?.message || error.message}`);
    }
};

// =============================================================================
// NEW: LinkedIn People Search Scraper (apify/linkedin-people-search-scraper)
// =============================================================================

/**
 * Starts the LinkedIn People Search Scraper
 * @param {string} token - Apify API Token
 * @param {Array<string>} keywords - Search keywords (e.g. ["Real Estate Investor"])
 * @param {Object} options - Search options (limit, location, etc.)
 * @returns {Promise<string>} - The Run ID
 */
export const startLinkedInPeopleSearch = async (token, keywords, options = {}) => {
    try {
        if (!keywords || keywords.length === 0) {
            console.warn("[LinkedInSearch] No keywords provided.");
            return null;
        }

        const ACTOR_ID = 'curious_coder~linkedin-people-search-scraper';

        const input = {
            searchQueries: keywords,
            maxProfiles: options.limit || 50,
            proxyConfiguration: { useApifyProxy: true },
            deepSearch: options.deepSearch !== undefined ? options.deepSearch : true,
            // Add other filters as needed by the actor schema
        };

        console.log(`[LinkedInSearch] Starting scrape for ${keywords.length} queries...`);
        console.log(`[LinkedInSearch] Sending payload to ${ACTOR_ID}:`, JSON.stringify(input, null, 2));

        const response = await axios.post(
            `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`,
            input,
            { headers: { 'Content-Type': 'application/json' } }
        );

        console.log(`[LinkedInSearch] Scrape started. Run ID: ${response.data.data.id}`);
        return response.data.data.id;
    } catch (error) {
        console.error('[LinkedInSearch] Start Error:', error.response?.data || error.message);
        throw new Error(`Failed to start LinkedIn Search: ${error.response?.data?.error?.message || error.message}`);
    }
};

// =============================================================================
// NEW: Google Search Scraper (apify/google-search-scraper)
// =============================================================================

/**
 * Starts the Google Search Scraper
 * @param {string} token - Apify API Token
 * @param {Array<string>} queries - Search queries
 * @param {Object} options - Search options
 * @returns {Promise<string>} - The Run ID
 */
export const startGoogleSearch = async (token, queries, options = {}) => {
    try {
        if (!queries || queries.length === 0) {
            console.warn("[GoogleSearch] No queries provided.");
            return null;
        }

        const ACTOR_ID = 'apify~google-search-scraper';

        const input = {
            queries: queries.join('\n'), // Actor expects 1 query per line or array? checking docs usually string or array. The actor accepts string "queries".
            maxPagesPerQuery: 1,
            resultsPerPage: options.limit || 10,
            countryCode: 'ca', // Focusing on Canada as most companies are Canadian? Or 'us'? Let's default to US or make it optional. 
            // Many of these companies are Canadian (REITs), so 'ca' might be better, or just generic.
            // Let's settle on no country code to be broad, or 'ca' if we know they are Canadian. 
            // Actually, best to leave countryCode undefined for global, or pass in options.
            customDataFunction: `async ({ input, $, request, response, html }) => {
                return {
                    pageTitle: $('title').text(),
                };
            }`,
        };

        // Adjust input structure for apify/google-search-scraper
        // It takes "queries" as a string (one per line) OR a property. 
        // Let's use the standard input format.

        const finalInput = {
            queries: queries.join('\n'),
            maxPagesPerQuery: 1,
            resultsPerPage: options.limit || 10,
            countryCode: 'ca', // Most of the orphans looked Canadian (REITs)
            saveHtml: false,
            saveHtmlToKeyValueStore: false,
            includeUnfilteredResults: false,
        };

        console.log(`[GoogleSearch] Starting scrape for ${queries.length} queries...`);
        // console.log(`[GoogleSearch] Input:`, JSON.stringify(finalInput, null, 2));

        const response = await axios.post(
            `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`,
            finalInput,
            { headers: { 'Content-Type': 'application/json' } }
        );

        console.log(`[GoogleSearch] Scrape started. Run ID: ${response.data.data.id}`);
        return response.data.data.id;
    } catch (error) {
        console.error('[GoogleSearch] Start Error:', error.response?.data || error.message);
        throw new Error(`Failed to start Google Search: ${error.response?.data?.error?.message || error.message}`);
    }
};

// =============================================================================
// NEW: Deep Website Scraper (for Company Profiler)
// Targets: Homepage, About, Services, Pricing
// =============================================================================

/**
 * Scrape a company's key pages (Home, About, Services, Pricing)
 * @param {string} domain - The company domain (e.g. "greybrook.com")
 * @param {string} token - Apify API Token
 * @param {Function} checkCancellation - Optional callback to check for cancellation
 */
export const scrapeCompanyWebsite = async (domain, token, checkCancellation = null) => {
    const ACTOR_ID = 'apify~website-content-crawler';
    if (!domain) return "No domain provided.";

    const url = domain.startsWith('http') ? domain : `https://${domain}`;

    // Configure crawler to find key pages
    const input = {
        startUrls: [{ url }],
        maxPagesPerCrawl: 5,
        maxConcurrency: 2,
        // Target subpages like /about, /services, /pricing
        globs: [
            { glob: `${url}/*about*` },
            { glob: `${url}/*service*` },
            { glob: `${url}/*pricing*` },
            { glob: `${url}/*solution*` },
            { glob: `${url}/*portfolio*` },
            { glob: `${url}/*project*` },
            { glob: `${url}/*transaction*` },
            { glob: `${url}/*asset*` },
            { glob: `${url}/*case-study*` },
            { glob: `${url}/*team*` },
            { glob: `${url}/*track-record*` },
            { glob: `${url}/` }
        ],
        saveHtml: false,
        removeElementsCssSelector: 'nav, footer, script, style, noscript, svg',
        crawlerType: 'cheerio' // Fast & cheap
    };

    try {
        console.log(`[Apify] Deep scraping ${domain}...`);
        const runUrl = `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`;
        const startRes = await axios.post(runUrl, input);
        const runId = startRes.data.data.id;

        // Poll (Max 2 mins for crawl)
        let attempts = 0;
        let datasetId = null;
        while (attempts < 60) {
            // Check for cancellation
            if (checkCancellation && await checkCancellation()) {
                await abortApifyRun(token, runId);
                return "Crawl cancelled.";
            }

            await new Promise(r => setTimeout(r, 2000));
            const statusRes = await checkApifyRun(token, runId);
            if (statusRes.status === 'SUCCEEDED') {
                datasetId = statusRes.datasetId;
                break;
            }
            if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(statusRes.status)) {
                throw new Error(`Crawl failed: ${statusRes.status}`);
            }
            attempts++;
        }

        if (!datasetId) return "Crawl timed out.";

        const results = await getApifyResults(token, datasetId);

        // Combine text from all pages
        const combinedText = results.map(r => {
            const cleanText = (r.text || "").replace(/\s+/g, ' ').trim();
            return `--- PAGE: ${r.url} ---\n${cleanText.substring(0, 3000)}`;
        }).join('\n\n');

        return combinedText || "No content found.";

    } catch (e) {
        console.warn(`[Apify] Scrape Error for ${domain}:`, e.message);
        return `Error scraping ${domain}: ${e.message}`;
    }
};

/**
 * Performs a Google Search using Gemini Grounding (Built-in Tool)
 * This avoids scraping blocks (CAPTCHA/IP bans) by letting Google's model do the search.
 */
export const performGoogleSearch = async (query, token, checkCancellation = null) => {
    const cleanQuery = query || "";
    if (!cleanQuery) return [];

    console.log(`[Search] Performing Grounded Search for: "${cleanQuery}"`);

    // We need the Gemini API Key. Since this is a service function, we might need to grab it from env
    // or pass it in. If 'token' is the Apify token, we probably ignore it here.
    // Assuming GOOGLE_API_KEY is in process.env (standard for this project)
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("❌ Missing GOOGLE_API_KEY for Grounded Search");
        return [];
    }

    try {
        const gemini = new GeminiModel(apiKey, 'gemini-2.0-flash-exp'); // Use flash-exp or 2.0-flash for search support

        const prompt = `
        Please search for the following query: "${cleanQuery}"
        
        Return a list of the top 20 most relevant search results.
        For each result, provide the Title and the Link (URI).
        
        The output must be JSON format:
        {
            "results": [
                { "title": "...", "link": "...", "snippet": "..." }
            ]
        }
        `;

        // Request usage of the googleSearch tool
        const response = await gemini.getResponse({
            input: prompt,
            tools: [{ name: 'googleSearch' }]
        });

        let results = [];

        // 1. Try to extract results directly from Grounding Metadata (Most Reliable)
        if (response.groundingMetadata?.groundingChunks) {
            console.log(`[Search] Found ${response.groundingMetadata.groundingChunks.length} grounding chunks.`);
            const groundResults = response.groundingMetadata.groundingChunks
                .map(chunk => ({
                    title: chunk.web?.title || "No Title",
                    link: chunk.web?.uri || "",
                    snippet: "" // Metadata uses 'groundingSupports' for snippets, complex to map back.
                }))
                .filter(r => r.link && r.link.startsWith('http'));

            if (groundResults.length > 0) {
                // De-duplicate by link
                const seen = new Set();
                groundResults.forEach(r => {
                    if (!seen.has(r.link)) {
                        seen.add(r.link);
                        results.push(r);
                    }
                });
            }
        }

        // 2. Fallback: Parse JSON output if grounding metadata didn't give enough/any results
        // (Only if results are empty, or maybe we want to merge? Usually metadata is better for pure links)
        if (results.length === 0) {
            const textOutput = response.output.find(o => o.type === 'message' && o.role === 'assistant')?.content?.[0]?.text;
            if (textOutput) {
                try {
                    // Try robust parsing with JSON5 to handle unescaped newlines/comments
                    const JSON5 = (await import('json5')).default;

                    // 1. Strip markdown code blocks
                    let cleanText = textOutput.replace(/```json/gi, '').replace(/```/g, '').trim();

                    // 2. Locate outermost JSON object
                    const firstBrace = cleanText.indexOf('{');
                    const lastBrace = cleanText.lastIndexOf('}');
                    if (firstBrace > -1 && lastBrace > firstBrace) {
                        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
                    }

                    const json = JSON5.parse(cleanText);
                    if (json.results && Array.isArray(json.results)) {
                        results = json.results;
                    }
                } catch (e) {
                    console.warn("[Search] Could not parse JSON directly from model text:", e.message);
                    // Last resort: Regex extraction if JSON fails completely
                    // ... (could add regex fallback here if needed)
                }
            }
        }

        console.log(`[Search] Grounded Search found ${results.length} results`);
        return results;

    } catch (e) {
        console.error("[Search] Grounded Search failed:", e.message);
        return [];
    }
};

// =============================================================================
// NEW: Dynamic Research Tools
// =============================================================================

/**
 * Scan a site to discover structure (Sitemap + Homepage Links)
 * @param {string} domain 
 * @param {string} token 
 */
export const scanSiteStructure = async (domain, token = null, checkCancellation = null) => {
    if (!domain) return "No domain provided.";
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    console.log(`[Local Scraper] Scanning structure for ${domain}...`);

    try {
        const cheerio = (await import('cheerio')).load;

        // 1. Try to fetch Homepage and look for internal links
        let response;
        try {
            response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/437.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
        } catch (e) {
            console.warn(`[Local Scraper] Homepage fetch failed: ${e.message}`);
        }

        const links = new Set();
        let text = "";

        if (response) {
            const $ = cheerio(response.data);
            $('script, style, noscript, nav, footer, header, svg, img').remove();
            text = $('body').text().replace(/\s+/g, ' ').substring(0, 5000);

            const baseUrl = url.split('//')[1].split('/')[0];
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
                    if (href.startsWith('/') || href.includes(baseUrl)) {
                        // Skip external or archival domains
                        if (href.includes('archive.org') || href.includes('facebook.com') || href.includes('twitter.com') ||
                            href.includes('linkedin.com') || href.includes('instagram.com') || href.includes('youtube.com')) {
                            return;
                        }

                        const fullUrl = href.startsWith('/') ? `${url.startsWith('https') ? 'https://' : 'http://'}${baseUrl}${href}` : href;
                        links.add(fullUrl.split('#')[0].split('?')[0].replace(/\/$/, ''));
                    }
                }
            });
        }

        // 2. Try to find Sitemap (Sitemaps are often at /sitemap.xml or mentioned in robots.txt)
        const commonSitemaps = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml'];
        for (const smPath of commonSitemaps) {
            try {
                const smUrl = `${url.replace(/\/$/, '')}${smPath}`;
                const smRes = await axios.get(smUrl, { timeout: 5000 });
                if (smRes.data && (smRes.data.includes('<urlset') || smRes.data.includes('<sitemapindex'))) {
                    console.log(`[Local Scraper] Found sitemap at ${smUrl}`);
                    const $sm = cheerio(smRes.data, { xmlMode: true });
                    $sm('loc').each((i, el) => {
                        const loc = $(el).text().trim();
                        if (loc) links.add(loc.replace(/\/$/, ''));
                    });
                }
            } catch (e) {
                // Ignore sitemap errors
            }
        }

        return {
            text: `HOMEPAGE SCAN (${url}):\n${text}`,
            links: [...links].slice(0, 200), // Limit for safety
            error: null
        };
    } catch (e) {
        console.warn(`[Local Scraper] Scan Error for ${domain}:`, e.message);
        return { text: "", links: [], error: e.message };
    }
};

/**
 * Smart Scraper: Discover -> Select -> Scrape
 * This combines discovery and scraping for the single-pass profiler
 * @param {string} domain 
 */
export const scrapeWebsiteSmart = async (domain) => {
    // 1. Scan Homepage
    const structure = await scanSiteStructure(domain);

    // 2. Select default relevant pages if LLM selection isn't used yet
    // (The LLM selection logic will be in workflow.js, this provides a fallback smart selection)
    const keyPages = structure.links.filter(link =>
        /about|team|people|portfolio|project|invest|service|contact|company/i.test(link)
    ).slice(0, 10);

    // 3. Scrape Selected
    const urlsToScrape = [`https://${domain}`, ...keyPages];
    const content = await scrapeSpecificPages(urlsToScrape);

    return {
        content: content,
        links: structure.links, // Return all links in case we want to Select again
        scrapedUrls: urlsToScrape
    };
};

/**
 * Scrape specific list of URLs with concurrency limit and progress updates
 * @param {Array<string>} urls 
 * @param {string} token - Apify Token for robust fallback
 * @param {Function} onProgress - Callback (msg) => void
 */
export const scrapeSpecificPages = async (urls, token = null, onProgress = () => { }) => {
    if (!urls || urls.length === 0) return "No URLs provided.";
    console.log(`[Local Scraper] Targeted scraping of ${urls.length} pages...`);

    const results = [];
    const CONCURRENCY_LIMIT = 3; // Scrape 3 pages at a time

    // Helper to process a single URL
    const processUrl = async (url) => {
        try {
            const cheerio = (await import('cheerio')).load;

            // Attempt 1: Fast local scrape with browser-like headers
            const response = await axios.get(url, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"macOS"',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                }
            });

            const $ = cheerio(response.data);
            $('script, style, noscript, nav, footer, header, svg, img').remove();
            let content = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 10000);

            if (content.length < 200) {
                throw new Error("Empty or very short content (likely SPA/blocked)");
            }

            console.log(`[Local Scraper] Successfully scraped ${url} (${content.length} chars)`);
            return `--- PAGE: ${url} ---\n${content}`;

        } catch (err) {
            console.warn(`[Local Scraper] Failed to scrape ${url} locally (${err.message}).`);

            // Attempt 2: High-quality fallback using Apify's headless browser scraper
            if (token) {
                try {
                    console.log(`[Local Scraper] Running Apify Render fallback for ${url}...`);
                    const ACTOR_ID = 'apify~web-scraper';
                    const runUrl = `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`;

                    const input = {
                        startUrls: [{ url }],
                        runMode: 'PRODUCTION',
                        pageFunction: "async function pageFunction(context) { const { page, request } = context; await page.waitForTimeout(3000); return { url: request.url, text: await page.innerText('body') }; }",
                        proxyConfiguration: { useApifyProxy: true }
                    };

                    const startRes = await axios.post(runUrl, input);
                    const runId = startRes.data.data.id;

                    // Poll for completion (Max 90s)
                    let attempts = 0;
                    let datasetId = null;
                    while (attempts < 45) {
                        await new Promise(r => setTimeout(r, 2000));
                        const statusRes = await checkApifyRun(token, runId);
                        if (statusRes.status === 'SUCCEEDED') {
                            datasetId = statusRes.datasetId;
                            break;
                        }
                        if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(statusRes.status)) break;
                        attempts++;
                    }

                    if (datasetId) {
                        const items = await getApifyResults(token, datasetId);
                        if (items && items.length > 0) {
                            const item = items[0];
                            let content = (item.text || "").replace(/\s+/g, ' ').trim().substring(0, 20000);

                            if (content.length > 300) {
                                console.log(`[Local Scraper] Apify fallback successful for ${url} (${content.length} chars)`);
                                return `--- PAGE (APIFY RENDER): ${url} ---\n${content}`;
                            } else {
                                console.log(`[Local Scraper] Apify fallback returned too little content (${content.length} chars).`);
                            }
                        }
                    }
                } catch (fallbackErr) {
                    console.error(`[Local Scraper] Apify Render fallback failed:`, fallbackErr.message);
                }
            }

            // Attempt 3: Desperate Search Snippet fallback
            if (token) {
                try {
                    console.log(`[Local Scraper] Trying Google Search fallback for ${url}...`);
                    const fallbackResults = await performGoogleSearch(`site:${url} team members bios`, token);
                    if (fallbackResults && fallbackResults.length > 0) {
                        const snippetText = fallbackResults.map(r => `${r.title}\n${r.snippet}`).join('\n\n');
                        return `--- PAGE (SEARCH FALLBACK): ${url} ---\n${snippetText}`;
                    }
                } catch (searchErr) {
                    console.error(`[Local Scraper] Search fallback failed for ${url}`);
                }
            }

            return `--- PAGE: ${url} ---\n(Error: ${err.message})`;
        }
    };


    // Process in Chunks (Sequentially process chunks, but items in chunk are concurrent)
    let completedCount = 0;
    const totalCount = urls.length;

    for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
        const chunk = urls.slice(i, i + CONCURRENCY_LIMIT);

        // Run chunk concurrently
        const chunkResults = await Promise.all(chunk.map(async (url) => {
            const res = await processUrl(url);
            completedCount++;
            onProgress(completedCount, totalCount); // Report progress
            return res;
        }));

        results.push(...chunkResults);
    }

    return results.join('\n\n');
};
// =============================================================================
// NEW: Full Site Deep Scraper (Cost & Time Tracked)
// =============================================================================

/**
 * Scrape a FULL website deeply, with cost and time tracking.
 * @param {string} domain - The company domain.
 * @param {string} token - Apify API Token.
 * @param {number} maxCost - Max cost in USD before auto-aborting (e.g. 5.00).
 * @param {Function} onProgress - Callback(stats) => void. Stats: { pages, cost, duration, status }
 */
export const scrapeFullSite = async (domain, token, maxCost = 5.00, onProgress = () => { }, options = {}) => {
    const ACTOR_ID = 'apify~website-content-crawler';
    if (!domain) throw new Error("No domain provided.");

    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    console.log(`[Apify] FULL SITE SCRAPE started for ${domain} (Limit: $${maxCost})`);

    // Deep Crawl Configuration
    const input = {
        startUrls: [{ url }],
        maxPagesPerCrawl: options.maxPages || 9999, // Allow override
        maxCrawlingDepth: options.maxDepth || 20,   // Allow override
        maxConcurrency: options.maxConcurrency || 50, // Allow override (default 50)
        saveHtml: false,
        saveMarkdown: true, // We want markdown for LLM
        removeElementsCssSelector: 'nav, footer, script, style, noscript, svg, .ad, .popup, .cookie-banner',
        crawlerType: 'cheerio', // Cheapest & Fastest
    };

    if (options.globs && options.globs.length > 0) {
        input.globs = options.globs.map(g => ({ glob: g }));
    }

    try {
        console.log(`[Apify] Starting run with input:`, JSON.stringify(input, null, 2));
        const runUrl = `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`;
        const startRes = await axios.post(runUrl, input);
        const runId = startRes.data.data.id;

        console.log(`[Apify] Run ID: ${runId}`);
        onProgress({ status: 'STARTING', pages: 0, cost: 0, duration: 0 });

        // Poll Loop
        let isComplete = false;
        let datasetId = null;
        let stats = { pages: 0, cost: 0, duration: 0, status: 'RUNNING' };

        while (!isComplete) {
            await new Promise(r => setTimeout(r, 5000)); // Poll every 5s

            try {
                // Check Run
                const checkRes = await axios.get(`${APIFY_API_URL}/actor-runs/${runId}?token=${token}`);
                const data = checkRes.data.data;
                const status = data.status;

                // Calculate Stats
                const statsObj = data.stats || {};
                // Aggressive detection of page counts from various possible Apify fields
                let pages = statsObj.requestsFinished ||
                    statsObj.crawlItemsCount ||
                    statsObj.storedItemsCount ||
                    statsObj.crawledPages ||
                    statsObj.requestCount || 0;

                // Fallback: Parse statusMessage (e.g., "Crawled 123/241 pages" or "829 results")
                if (pages === 0 && data.statusMessage) {
                    const match = data.statusMessage.match(/(\d+)\//) ||
                        data.statusMessage.match(/(\d+)\s+pages/) ||
                        data.statusMessage.match(/(\d+)\s+results/);
                    if (match) pages = parseInt(match[1]);
                }

                console.log(`[Apify] Run ${runId} stats:`, {
                    status,
                    pages,
                    cost: data.usageTotalUsd,
                    msg: data.statusMessage
                });

                const duration = (Date.now() - new Date(data.startedAt).getTime()) / 1000; // seconds

                // Cost Estimation
                const cost = data.usageTotalUsd || 0;

                // Construction of a human-readable status for the UI
                const statusMessage = `Scraping: ${pages} pages found ($${cost.toFixed(2)})`;
                stats = { pages, cost, duration, status: statusMessage };
                onProgress(stats);

                // Safety Checks
                if (cost > maxCost) {
                    console.warn(`[Apify] Cost limit exceeded ($${cost} > $${maxCost}). Aborting...`);
                    await abortApifyRun(token, runId);
                    const finalStatus = 'PARTIAL_LIMIT_REACHED';

                    onProgress({ ...stats, status: finalStatus });

                    // ATTEMPT TO SAVE PARTIAL DATA
                    console.log(`[Apify] Fetching partial results for run ${runId}...`);
                    try {
                        const results = await getApifyResults(token, data.defaultDatasetId);

                        return {
                            ...stats,
                            status: finalStatus,
                            items: results, // Return raw items for chunked processing
                            datasetId: data.defaultDatasetId,
                            aborted: true
                        };
                    } catch (e) {
                        console.error("Failed to fetch partial results", e);
                        return { ...stats, status: finalStatus, aborted: true, content: "Failed to retrieve partial content." };
                    }
                }

                if (['SUCCEEDED', 'ABORTED', 'TIMED-OUT', 'FAILED'].includes(status)) {
                    isComplete = true;
                    datasetId = data.defaultDatasetId;
                    if (status === 'SUCCEEDED') stats.status = 'COMPLETED';
                    else stats.status = status;
                }
            } catch (pollError) {
                console.error(`[Apify] Polling error for run ${runId}:`, pollError.message);
                console.error(`[Apify] Full error:`, pollError);
                // Continue polling despite errors - don't crash the entire loop
            }
        }

        console.log(`[Apify] Run finished. Status: ${stats.status}. Downloading results in chunks...`);

        // Fetch Results in Chunks
        const datasetInfo = await getDatasetInfo(token, datasetId);
        const totalItems = datasetInfo?.itemCount || stats.pages || 0;

        console.log(`[Apify] Dataset Info:`, { datasetId, itemCount: datasetInfo?.itemCount, statsPages: stats.pages });

        const results = [];
        const CHUNK_SIZE = 500;

        // If totalItems is 0 but we know the run succeeded, try to fetch at least first batch
        const fetchLimit = totalItems > 0 ? totalItems : 1000;

        if (totalItems === 0) {
            console.log(`[Apify] Item count reported as 0. Attempting one-off fetch as fallback...`);
            const chunk = await getApifyResults(token, datasetId, 0, 1000);
            if (chunk && chunk.length > 0) {
                console.log(`[Apify] Fallback fetch found ${chunk.length} items.`);
                results.push(...chunk);
            }
        } else {
            for (let offset = 0; offset < totalItems; offset += CHUNK_SIZE) {
                const currentCount = Math.min(offset + CHUNK_SIZE, totalItems);
                const approxSizeKB = (currentCount * 5).toFixed(0);

                const percent = Math.round((currentCount / totalItems) * 100);
                onProgress({
                    ...stats,
                    status: `Downloading: ${currentCount}/${totalItems} pages (~${approxSizeKB} KB)...`,
                    percent
                });

                const chunk = await getApifyResults(token, datasetId, offset, CHUNK_SIZE);
                results.push(...chunk);
            }
        }

        console.log(`[Apify] Download complete. Total items: ${results.length}`);

        return {
            ...stats,
            items: results,
            datasetId,
            aborted: false
        };

    } catch (e) {
        console.error(`[Apify] Full Scrape Error:`, e);
        throw e;
    }
};
