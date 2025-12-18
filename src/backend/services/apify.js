import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';

/**
 * Triggers the x_guru/Leads-Scraper-apollo-zoominfo actor
 * @param {string} token - Apify API Token
 * @param {Array<string>} domains - List of company domains
 * @returns {Promise<string>} - The Run ID
 */
export const startApifyScrape = async (token, domains, filters = {}) => {
    try {
        // --- Filter Logic ---
        let seniority = ["cxo", "owner", "partner", "director", "vp"]; // Default high quality
        let emailStatus = "verified"; // Default high quality
        let jobTitles = [];

        if (filters) {
            // 1. Job Titles (Direct Mapping)
            if (filters.job_titles && Array.isArray(filters.job_titles) && filters.job_titles.length > 0) {
                jobTitles = filters.job_titles;
            }

            // 2. Email Quality
            if (filters.email_quality && filters.email_quality.toLowerCase().includes('verified')) {
                emailStatus = "verified";
            } else if (filters.email_quality) {
                emailStatus = "all"; // User explicitly picked looser constraints (e.g. "LinkedIn Only")
            }

            // 3. Seniority Inference (Text Analysis)
            if (filters.seniority_input) {
                const text = filters.seniority_input.toLowerCase();
                const inferredSeniority = [];
                if (text.includes('cxo') || text.includes('chief') || text.includes('c-level')) inferredSeniority.push('cxo');
                if (text.includes('owner') || text.includes('founder')) inferredSeniority.push('owner', 'partner');
                if (text.includes('director')) inferredSeniority.push('director');
                if (text.includes('vp') || text.includes('president')) inferredSeniority.push('vp');
                if (text.includes('manager') || text.includes('head')) inferredSeniority.push('manager', 'head_of_department');
                if (text.includes('entry') || text.includes('junior')) inferredSeniority.push('entry');

                // If we found specific instructions, OVERRIDE the default. Otherwise keep default.
                if (inferredSeniority.length > 0) {
                    seniority = inferredSeniority;
                }
            }
        }

        const input = {
            company_domains: domains,
            max_results: 100,
            job_title_seniority: seniority,
            email_status: emailStatus,
            job_titles: jobTitles.length > 0 ? jobTitles : undefined
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
