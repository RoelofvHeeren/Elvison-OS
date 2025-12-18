import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';

/**
 * Triggers the x_guru/Leads-Scraper-apollo-zoominfo actor
 * @param {string} token - Apify API Token
 * @param {Array<string>} domains - List of company domains
 * @returns {Promise<string>} - The Run ID
 */
export const startApifyScrape = async (token, domains) => {
    try {
        const input = {
            company_domains: domains,
            max_results: 100 // Safe default
        };

        const response = await axios.post(
            `${APIFY_API_URL}/acts/x_guru~Leads-Scraper-apollo-zoominfo/runs?token=${token}`,
            input,
            { headers: { 'Content-Type': 'application/json' } }
        );

        return response.data.data.id;
    } catch (error) {
        console.error('Apify Start Error:', error.response?.data || error.message);
        throw new Error(`Failed to start Apify job: ${error.response?.data?.error?.message || error.message}`);
    }
};

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
