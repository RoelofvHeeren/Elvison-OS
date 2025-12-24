/**
 * ScraperCity Apollo Integration
 * 
 * Uses ScraperCity's Apollo scraper API to fetch leads.
 * This requires an Apollo search URL (from Apollo.io's saved search) and a count.
 * 
 * API Flow:
 * 1. POST /scrape/apollo with { url, count } -> returns { runId }
 * 2. GET /scrape/apollo/status/{runId} -> returns { status, ... }
 * 3. GET /scrape/apollo/download/{runId} -> returns results array
 */
import axios from 'axios';

const SCRAPERCITY_BASE_URL = 'https://app.scrapercity.com/api/v1';

/**
 * Build an Apollo search URL from company names and filters
 * 
 * ScraperCity expects an Apollo.io browser URL (the URL you'd see in your browser when searching).
 * Apollo uses hash-based routing: https://app.apollo.io/#/people?...
 * 
 * @param {Array<string>} companyNames - List of company names to search
 * @param {Object} filters - Search filters
 * @returns {string} - Apollo browser search URL
 */
export const buildApolloSearchUrl = (companyNames, filters = {}) => {
    // Apollo browser URL format uses hash routing
    const baseUrl = 'https://app.apollo.io/#/people';

    // Build query params
    const params = new URLSearchParams();

    // Organization names - Apollo uses organizationNames[] for multiple
    if (companyNames && companyNames.length > 0) {
        // Apollo expects each company as a separate param or comma-separated
        params.set('organizationNames[]', companyNames.join('\n'));
    }

    // Seniority - Apollo uses personSeniorities[]
    const seniorities = filters.seniority || ['director', 'vp', 'c_suite', 'founder', 'owner', 'partner'];
    seniorities.forEach(s => {
        params.append('personSeniorities[]', s);
    });

    // Job titles - personTitles[]
    if (filters.job_titles && filters.job_titles.length > 0) {
        filters.job_titles.forEach(title => {
            params.append('personTitles[]', title);
        });
    }

    // Countries - personLocations[]
    const countries = filters.countries || ['United States', 'Canada'];
    countries.forEach(c => {
        params.append('personLocations[]', c);
    });

    // Verified emails only
    params.set('emailStatus', 'verified');

    return `${baseUrl}?${params.toString()}`;
};

/**
 * Start a ScraperCity Apollo scrape
 * 
 * @param {string} apiKey - ScraperCity API key
 * @param {string} apolloUrl - The Apollo search URL
 * @param {number} count - Number of leads to scrape
 * @returns {Promise<string>} - Run ID
 */
export const startScraperCityScrape = async (apiKey, apolloUrl, count = 100) => {
    try {
        console.log(`[ScraperCity] Starting Apollo scrape for ${count} contacts...`);

        const response = await axios.post(
            `${SCRAPERCITY_BASE_URL}/scrape/apollo`,
            { url: apolloUrl, count },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`[ScraperCity] Scrape started. Run ID: ${response.data.runId}`);
        return response.data.runId;
    } catch (error) {
        console.error('[ScraperCity] Start Error:', error.response?.data || error.message);
        throw new Error(`Failed to start ScraperCity job: ${error.response?.data?.message || error.message}`);
    }
};

/**
 * Check the status of a ScraperCity run
 * 
 * @param {string} apiKey - ScraperCity API key
 * @param {string} runId - The run ID
 * @returns {Promise<Object>} - { status, progress, ... }
 */
export const checkScraperCityRun = async (apiKey, runId) => {
    try {
        const response = await axios.get(
            `${SCRAPERCITY_BASE_URL}/scrape/apollo/status/${runId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('[ScraperCity] Status Check Error:', error.response?.data || error.message);
        throw new Error('Failed to check ScraperCity run status');
    }
};

/**
 * Download results from a completed ScraperCity run
 * 
 * @param {string} apiKey - ScraperCity API key
 * @param {string} runId - The run ID
 * @returns {Promise<Array>} - Array of lead objects
 */
export const getScraperCityResults = async (apiKey, runId) => {
    try {
        const response = await axios.get(
            `${SCRAPERCITY_BASE_URL}/scrape/apollo/download/${runId}`,
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        return response.data;
    } catch (error) {
        console.error('[ScraperCity] Download Error:', error.response?.data || error.message);
        throw new Error('Failed to download ScraperCity results');
    }
};
