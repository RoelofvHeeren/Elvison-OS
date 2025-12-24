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
 * Apollo's search URL format encodes filters as query parameters
 * 
 * @param {Array<string>} companyNames - List of company names to search
 * @param {Object} filters - Search filters
 * @returns {string} - Apollo search URL
 */
export const buildApolloSearchUrl = (companyNames, filters = {}) => {
    // Apollo uses a specific URL format for saved searches
    // The base URL for people search
    const baseUrl = 'https://app.apollo.io/api/v1/mixed_people/search';

    // Build query params for Apollo
    const params = new URLSearchParams();

    // Companies - Apollo expects organization names
    if (companyNames && companyNames.length > 0) {
        params.set('organization_names', companyNames.join(','));
    }

    // Seniority levels
    const seniorities = filters.seniority || ['director', 'vp', 'c_suite', 'founder', 'owner', 'partner'];
    params.set('person_seniorities', seniorities.join(','));

    // Job titles - Apollo is flexible, we can pass our actual titles
    if (filters.job_titles && filters.job_titles.length > 0) {
        params.set('person_titles', filters.job_titles.join(','));
    }

    // Countries
    const countries = filters.countries || ['United States', 'Canada'];
    params.set('person_locations', countries.join(','));

    // We want verified emails
    params.set('email_status', 'verified');

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
