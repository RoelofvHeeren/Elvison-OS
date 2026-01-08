/**
 * Google Search Service
 * Uses Apify's Google Search Scraper for high-volume, paginated search results.
 * Replaces the limited Gemini Search Grounding approach.
 */

import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';
const GOOGLE_SEARCH_ACTOR_ID = 'nFJndFXA5zjCTuudP'; // Official Apify Google Search Scraper

/**
 * Build the payload for Apify Google Search Scraper
 * @param {string|string[]} queries - Search term(s)
 * @param {Object} options - Configuration options
 * @returns {Object} - Apify actor input payload
 */
export const buildApifySearchPayload = (queries, options = {}) => {
    const {
        maxPagesPerQuery = 10, // 10 pages × 10 results = 100 results max
        countryCode = 'ca', // Default to Canada for real estate ICP
        languageCode = 'en',
        mobileResults = false
    } = options;

    // Normalize queries to array
    const queryArray = Array.isArray(queries) ? queries : [queries];

    return {
        queries: queryArray.join('\n'),
        countryCode,
        languageCode,
        maxPagesPerQuery,
        resultsPerPage: 10, // Google now limits to 10 per page
        mobileResults,
        includeUnfilteredResults: false,
        saveHtml: false,
        saveHtmlToKeyValueStore: false,
        maxConcurrency: 5
    };
};

/**
 * Start the Apify Google Search Scraper actor
 * @param {string} token - Apify API token
 * @param {string|string[]} queries - Search queries
 * @param {Object} options - Search options
 * @returns {Promise<string>} - Run ID
 */
export const startGoogleSearch = async (token, queries, options = {}) => {
    const payload = buildApifySearchPayload(queries, options);

    console.log(`[GoogleSearch] Starting Apify search for: ${JSON.stringify(queries)}`);

    const response = await axios.post(
        `${APIFY_API_URL}/acts/${GOOGLE_SEARCH_ACTOR_ID}/runs?token=${token}`,
        payload,
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        }
    );

    const runId = response.data?.data?.id;
    if (!runId) {
        throw new Error('Failed to start Apify Google Search actor');
    }

    console.log(`[GoogleSearch] Started run: ${runId}`);
    return runId;
};

/**
 * Check the status of an Apify run
 * @param {string} token - Apify API token
 * @param {string} runId - Run ID
 * @returns {Promise<{status: string, datasetId: string|null}>}
 */
export const checkSearchStatus = async (token, runId) => {
    const response = await axios.get(
        `${APIFY_API_URL}/actor-runs/${runId}?token=${token}`,
        { timeout: 10000 }
    );

    const data = response.data?.data;
    return {
        status: data?.status || 'UNKNOWN',
        datasetId: data?.defaultDatasetId || null
    };
};

/**
 * Get results from the Apify dataset
 * @param {string} token - Apify API token
 * @param {string} datasetId - Dataset ID
 * @returns {Promise<Array>} - Raw search results
 */
export const getSearchResults = async (token, datasetId) => {
    const response = await axios.get(
        `${APIFY_API_URL}/datasets/${datasetId}/items?token=${token}&format=json`,
        { timeout: 30000 }
    );

    return response.data || [];
};

/**
 * Parse Apify search results into a clean format
 * @param {Array} rawResults - Raw Apify results
 * @returns {Array<{title: string, link: string, snippet: string, domain: string}>}
 */
export const parseSearchResults = (rawResults) => {
    const results = [];
    const seenDomains = new Set();

    for (const item of rawResults) {
        // Skip non-organic results
        if (!item.organicResults) continue;

        for (const organic of item.organicResults) {
            const link = organic.url || organic.link || '';
            if (!link || !link.startsWith('http')) continue;

            // Extract domain
            let domain = '';
            try {
                const url = new URL(link);
                domain = url.hostname.replace(/^www\./, '');
            } catch (e) {
                continue;
            }

            // Skip if we've already seen this domain (dedup)
            if (seenDomains.has(domain)) continue;
            seenDomains.add(domain);

            results.push({
                title: organic.title || '',
                link: link,
                snippet: organic.description || organic.snippet || '',
                domain: domain
            });
        }
    }

    console.log(`[GoogleSearch] Parsed ${results.length} unique results (deduped by domain)`);
    return results;
};

/**
 * Main function: Run a Google Search and return parsed results
 * Waits for completion with polling.
 * 
 * @param {string} query - Search query
 * @param {Object} options - Options
 * @param {Function} checkCancellation - Optional cancellation callback
 * @returns {Promise<{results: Array, count: number}>}
 */
export const runGoogleSearch = async (query, options = {}) => {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
        console.error('[GoogleSearch] Missing APIFY_API_TOKEN');
        return { results: [], count: 0 };
    }

    const {
        maxPagesPerQuery = 10,
        countryCode = 'ca',
        checkCancellation = null
    } = options;

    try {
        // 1. Start the search
        const runId = await startGoogleSearch(token, query, { maxPagesPerQuery, countryCode });

        // 2. Poll for completion (max 5 minutes)
        const maxWaitMs = 300000;
        const pollInterval = 3000;
        let elapsed = 0;
        let status = 'RUNNING';
        let datasetId = null;

        while (status === 'RUNNING' && elapsed < maxWaitMs) {
            if (checkCancellation && await checkCancellation()) {
                console.log('[GoogleSearch] Cancellation detected, aborting');
                return { results: [], count: 0 };
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
            elapsed += pollInterval;

            const check = await checkSearchStatus(token, runId);
            status = check.status;
            datasetId = check.datasetId;

            console.log(`[GoogleSearch] Status: ${status} (${elapsed / 1000}s elapsed)`);
        }

        if (status !== 'SUCCEEDED') {
            console.error(`[GoogleSearch] Search failed with status: ${status}`);
            return { results: [], count: 0 };
        }

        // 3. Fetch and parse results
        const rawResults = await getSearchResults(token, datasetId);
        const parsed = parseSearchResults(rawResults);

        return {
            results: parsed,
            count: parsed.length
        };

    } catch (err) {
        console.error('[GoogleSearch] Error:', err.message);
        return { results: [], count: 0 };
    }
};

/**
 * Run search for multiple queries sequentially
 * Useful for batch processing the search term queue
 * 
 * @param {string[]} queries - Array of search queries
 * @param {Object} options - Options
 * @returns {Promise<{results: Array, perQuery: Object}>}
 */
export const runMultipleSearches = async (queries, options = {}) => {
    const allResults = [];
    const perQuery = {};

    for (const query of queries) {
        console.log(`[GoogleSearch] Processing query: "${query}"`);
        const { results, count } = await runGoogleSearch(query, options);

        allResults.push(...results);
        perQuery[query] = count;

        // Small delay between queries to be nice to Apify
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { results: allResults, perQuery };
};

export default {
    runGoogleSearch,
    runMultipleSearches,
    buildApifySearchPayload,
    parseSearchResults
};
