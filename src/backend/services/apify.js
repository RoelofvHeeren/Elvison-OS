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
 * Fetches results from the dataset
 * @param {string} token 
 * @param {string} datasetId 
 * @returns {Promise<Array>} - Array of results
 */
export const getApifyResults = async (token, datasetId) => {
    try {
        const response = await axios.get(
            `${APIFY_API_URL}/datasets/${datasetId}/items?token=${token}`
        );
        return response.data;
    } catch (error) {
        console.error('Apify Result Error:', error.response?.data || error.message);
        throw new Error('Failed to fetch results');
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
    // Default titles covering executives and decision-makers
    // Default titles matching successful Apify console run
    const defaultTitles = [
        "Executive Director", "Director Of Operations", "Director Of Sales", "Director Of Business Development",
        "Founder", "Co-Founder", "General Manager", "Head Of Operations", "Head Of Business Development",
        "Founding Partner", "Co-Owner", "Business Owner", "CEO/President/Owner", "Executive Vice President",
        "Principal", "Managing Director", "Director of Investments", "Director of Developments", "Partner",
        "Managing Partner", "CEO", "President", "Vice President", "CIO", "COO"
    ];

    // Default seniorities
    const defaultSeniorities = [
        "Founder", "Chairman", "President", "CEO", "CXO",
        "Vice President", "Director", "Head"
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
        companyDomains: cleanDomains,
        organizationDomains: cleanDomains, // Common alias
        qOrganizationDomains: cleanDomains.join('\n'), // Apollo URL format (newline separated)

        // Person Filters
        personTitle: (filters.job_titles && filters.job_titles.length > 0) ? filters.job_titles : defaultTitles,
        seniority: (mappedSeniority && mappedSeniority.length > 0) ? mappedSeniority : defaultSeniorities,

        // Email Settings
        contactEmailStatus: "verified", // Strict verification
        includeEmails: true,
        skipLeadsWithoutEmails: true,

        // Limits
        totalResults: Math.min(filters.maxLeads ? (filters.maxLeads * 100) : 1000, 1000)
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
                    const json = JSON.parse(gemini.constructor.extractJson ? gemini.constructor.extractJson(textOutput) : textOutput.replace(/```json/g, '').replace(/```/g, '').trim());
                    if (json.results && Array.isArray(json.results)) {
                        results = json.results;
                    }
                } catch (e) {
                    console.warn("[Search] Could not parse JSON directly from model text:", e.message);
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
        // Use cheerio for fast static analysis
        const cheerio = (await import('cheerio')).load;
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const $ = cheerio(response.data);

        // Clean text
        $('script, style, noscript, nav, footer, header, svg, img').remove();
        const text = $('body').text().replace(/\s+/g, ' ').substring(0, 5000);

        // Get internal links
        const baseUrl = url.split('//')[1].split('/')[0];
        const links = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes(baseUrl) || href.startsWith('/')) && !href.startsWith('#')) {
                const fullUrl = href.startsWith('/') ? `${url.startsWith('https') ? 'https://' : 'http://'}${baseUrl}${href}` : href;
                const lower = fullUrl.toLowerCase();
                if (lower.includes('about') || lower.includes('team') || lower.includes('people') ||
                    lower.includes('portfolio') || lower.includes('project') || lower.includes('invest')) {
                    links.push(fullUrl);
                }
            }
        });

        const uniqueLinks = [...new Set(links)];

        // Return object structure for Smart Select logic
        return {
            text: `HOMEPAGE SCAN (${url}):\n${text}`,
            links: uniqueLinks,
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
 * Scrape specific list of URLs
 * @param {Array<string>} urls 
 * @param {string} token 
 */
export const scrapeSpecificPages = async (urls, token = null, checkCancellation = null) => {
    if (!urls || urls.length === 0) return "No URLs provided.";
    console.log(`[Local Scraper] Targeted scraping of ${urls.length} pages...`);

    const results = [];
    const cheerio = (await import('cheerio')).load;

    for (const url of urls) {
        if (checkCancellation && await checkCancellation()) break;

        try {
            const response = await axios.get(url, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            const $ = cheerio(response.data);

            // Remove noise
            $('script, style, noscript, nav, footer, header, svg, img').remove();

            const text = $('body').text().replace(/\s+/g, ' ').substring(0, 8000);
            results.push(`--- PAGE: ${url} ---\n${text}`);

        } catch (err) {
            console.warn(`[Local Scraper] Failed to scrape ${url}: ${err.message}`);
            results.push(`--- PAGE: ${url} ---\n(Error: ${err.message})`);
        }
    }

    return results.join('\n\n');
};
