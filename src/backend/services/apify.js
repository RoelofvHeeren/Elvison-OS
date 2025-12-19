import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';

/**
 * Triggers the pipelinelabs/lead-scraper-apollo-zoominfo-lusha actor
 * @param {string} token - Apify API Token
 * @param {Array<string>} domains - List of company domains
 * @param {Object} filters - Dynamic filters from onboarding
 * @returns {Promise<string>} - The Run ID
 */
/**
 * Constructs the payload for Pipeline Labs scraper
 * @param {Array<string>} companyNames - List of company names
 * @param {Object} filters - Dynamic filters
 * @returns {Object} - The constructed payload
 */
export const buildPipelineLabsPayload = (companyNames, filters = {}) => {
    // defaults
    let seniorityIncludes = ["Director", "VP", "C-Suite", "Owner", "Head", "Founder", "Partner"];
    let seniorityExcludes = ["Entry", "Intern"];
    let personTitleIncludes = [
        "Executive Director", "Director Of Operations", "Director Of Sales",
        "Director Of Business Development", "Founder", "Co-Founder",
        "General Manager", "Head Of Operations", "Head Of Business Development",
        "Founding Partner", "Co-Owner", "Business Owner", "CEO/President/Owner",
        "Executive Vice President"
    ];
    let companyLocationCountryIncludes = filters.countries || ["United States", "Canada"];

    // Explicit exclusions if needed, currently not in template but good practice
    // const titleExcludes = ["Assistant", "Intern"];

    if (filters && filters.fetchAll) {
        // Broaden search
        seniorityIncludes = [];
        personTitleIncludes = []; // Clear strict titles for broad search
    } else if (filters) {
        // 1. Job Titles
        if (filters.job_titles && Array.isArray(filters.job_titles) && filters.job_titles.length > 0) {
            personTitleIncludes = filters.job_titles;
        }

        // 2. Seniority Inference
        if (filters.seniority_input) {
            const text = filters.seniority_input.toLowerCase();
            const inferred = [];
            if (text.includes('cxo') || text.includes('chief') || text.includes('c-level')) inferred.push('C-Suite');
            if (text.includes('owner') || text.includes('founder')) inferred.push('Owner', 'Founder', 'Partner');
            if (text.includes('director')) inferred.push('Director');
            if (text.includes('vp') || text.includes('president') || text.includes('vice')) inferred.push('VP');
            if (text.includes('manager') || text.includes('head')) inferred.push('Head', 'Manager'); // Manager not in template list but kept for mapping

            if (inferred.length > 0) seniorityIncludes = inferred;
        }
    }

    // Cleaning company names to ensure no domains slip through
    const cleanNames = companyNames.map(name => {
        // simple heuristic: if it looks like a domain, strip tld. 
        // But ideal is to assume caller passes names. 
        // We will just pass it through but we could add logic here.
        return name;
    }).filter(n => n && typeof n === 'string' && n.length > 0);

    return {
        totalResults: 100,
        personTitleIncludes: personTitleIncludes,
        includeSimilarTitles: true, // Fixed as per template
        personTitleExtraIncludes: [
            "Chief Investment Officer", "Principle", "Managing Director", // Principle is typo in template but we match it
            "Director of investments", "Director of developments"
        ],
        seniorityIncludes: seniorityIncludes,
        seniorityExcludes: seniorityExcludes,
        companyNameIncludes: cleanNames,
        companyLocationCountryIncludes: companyLocationCountryIncludes,
        companyEmployeeSizeIncludes: [
            "11-20", "21-50", "51-100", "201-500", "501-1000",
            "1001-2000", "5001-10000", "10001+"
        ]
    };
};

/**
 * Triggers the pipelinelabs/lead-scraper-apollo-zoominfo-lusha actor
 * @param {string} token - Apify API Token
 * @param {Array<string>} companyNames - List of company names (NOT domains)
 * @param {Object} filters - Dynamic filters
 * @returns {Promise<string>} - The Run ID
 */
export const startApifyScrape = async (token, companyNames, filters = {}) => {
    try {
        if (!companyNames || companyNames.length === 0) {
            console.warn("startApifyScrape called with no company names.");
            // We could throw or return strict null, but let's allow it to attempt if that's desired behavior, 
            // though likely it will be empty. 
        }

        const input = buildPipelineLabsPayload(companyNames, filters);

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
