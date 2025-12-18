import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';

/**
 * Triggers the pipelinelabs/lead-scraper-apollo-zoominfo-lusha actor
 * @param {string} token - Apify API Token
 * @param {Array<string>} domains - List of company domains
 * @param {Object} filters - Dynamic filters from onboarding
 * @returns {Promise<string>} - The Run ID
 */
export const startApifyScrape = async (token, domains, filters = {}) => {
    try {
        // --- Filter Logic (Pipelinelabs Schema) ---
        // Defaults: C-Suite/VP/Director + Verified Email + Mobile if possible

        let seniority = ["C-Suite", "Director", "VP", "Owner", "Partner"];
        let contactEmailStatus = ["Verified", "Guessed"]; // Default to broader search to avoid 0 results
        let personTitle = [];

        if (filters) {
            // 1. Job Titles (Direct Mapping)
            if (filters.job_titles && Array.isArray(filters.job_titles) && filters.job_titles.length > 0) {
                personTitle = filters.job_titles;
            }

            // 2. Email Quality
            if (filters.email_quality && filters.email_quality.toLowerCase().includes('verified')) {
                contactEmailStatus = ["Verified"];
            } else if (filters.email_quality) {
                // If user says "LinkedIn only" or looser, we accept Verified and Guessed 
                contactEmailStatus = ["Verified", "Guessed"];
            }

            // 3. Seniority Inference (Text Analysis -> Pipelinelabs Enum)
            if (filters.seniority_input) {
                const text = filters.seniority_input.toLowerCase();
                const inferred = [];
                // Pipelinelabs uses specific strings: "C-Suite", "Director", "VP", "Manager", "Senior", "Entry", "Owner", "Partner"
                if (text.includes('cxo') || text.includes('chief') || text.includes('c-level')) inferred.push('C-Suite');
                if (text.includes('owner') || text.includes('founder')) inferred.push('Owner', 'Partner');
                if (text.includes('director')) inferred.push('Director');
                if (text.includes('vp') || text.includes('president') || text.includes('vice')) inferred.push('VP');
                if (text.includes('manager') || text.includes('head')) inferred.push('Manager');
                if (text.includes('mid') || text.includes('senior')) inferred.push('Senior');
                if (text.includes('entry') || text.includes('junior')) inferred.push('Entry', 'Intern');

                if (inferred.length > 0) seniority = inferred;
            }
        }

        const input = {
            companyDomain: domains,
            totalResults: 100,
            seniority: seniority,
            contactEmailStatus: contactEmailStatus,
            personTitle: personTitle.length > 0 ? personTitle : undefined,
            hasEmail: true,
            hasPhone: false
        };

        // PIPELINELABS ACTOR ID
        const ACTOR_ID = 'pipelinelabs~lead-scraper-apollo-zoominfo-lusha';

        const response = await axios.post(
            `${APIFY_API_URL}/acts/${ACTOR_ID}/runs?token=${token}`,
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
