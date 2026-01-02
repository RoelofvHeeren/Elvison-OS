
import axios from 'axios';

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

    return {
        companyDomain: cleanDomains,
        companyCountry: filters.countries || ["United States", "Canada", "United Kingdom"], // Broader default
        companyEmployeeSize: sizeMapping,

        // Person Filters
        personTitle: (filters.job_titles && filters.job_titles.length > 0) ? filters.job_titles : defaultTitles,
        seniority: (mappedSeniority && mappedSeniority.length > 0) ? mappedSeniority : defaultSeniorities,
        // functional: mappedFunctions, // REMOVED: Strict function mapping drops empty-function executives. We filter locally.

        // Location (Optional - usually inferred from company but can be specific)
        // personCountry: ["United States"], 

        // Email Settings
        contactEmailStatus: "verified", // Strict verification
        includeEmails: true,
        skipLeadsWithoutEmails: true,

        // Limits
        totalResults: filters.maxResults || 2500 // Rental allows higher volume per run
    };
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
 * Perform a Google Search via Apify (apify/google-search-scraper)
 * @param {string} query - The search query
 * @param {string} token - Apify API Token
 * @param {Function} checkCancellation - Optional callback to check for cancellation
 */
export const performGoogleSearch = async (query, token, checkCancellation = null) => {
    const ACTOR_ID = 'apify~google-search-scraper';
    const cleanQuery = query || "";
    if (!cleanQuery) return [];

    const input = {
        queries: cleanQuery,
        resultsPerPage: 20,
        maxPagesPerQuery: 1,
        languageCode: "",
        mobileResults: false,
        includeUnfilteredResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
        includeIcons: false
    };

    try {
        const url = `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`;
        const startRes = await axios.post(url, input);
        const runId = startRes.data.data.id;

        // Poll
        const POLL_INTERVAL = 2000;
        const MAX_ATTEMPTS = 30; // 60s max
        let attempts = 0;
        let datasetId = null;

        while (attempts < MAX_ATTEMPTS) {
            // Check for cancellation
            if (checkCancellation && await checkCancellation()) {
                await abortApifyRun(token, runId);
                return [];
            }

            await new Promise(r => setTimeout(r, POLL_INTERVAL));
            const statusRes = await checkApifyRun(token, runId);
            if (statusRes.status === 'SUCCEEDED') {
                datasetId = statusRes.datasetId;
                break;
            }
            if (statusRes.status === 'FAILED' || statusRes.status === 'ABORTED') {
                throw new Error("Search failed on Apify side.");
            }
            attempts++;
        }

        if (!datasetId) throw new Error("Search timeout.");

        // Fetch
        const results = await getApifyResults(token, datasetId);

        // Normalize to simple { title, link, snippet }
        return results.flatMap(r => r.organicResults || []).map(r => ({
            title: r.title,
            link: r.url,
            snippet: r.description
        }));

    } catch (e) {
        console.warn("Google Search Error:", e.message);
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
        return `HOMEPAGE SCAN (${url}):\n${text}\n\nDISCOVERED LINKS:\n${uniqueLinks.slice(0, 50).join('\n')}`;

    } catch (e) {
        console.warn(`[Local Scraper] Scan Error for ${domain}:`, e.message);
        return `Error scanning ${domain}: ${e.message}`;
    }
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
