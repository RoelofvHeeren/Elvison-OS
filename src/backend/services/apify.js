import {
    ALLOWED_PERSON_TITLES,
    ALLOWED_SENIORITY,
    ALLOWED_EXTRA_TITLES,
    SENIORITY_EXCLUDES,
    API_TITLE_MAPPING
} from '../../config/pipelineLabs.js';
import axios from 'axios';

const APIFY_API_URL = 'https://api.apify.com/v2';

/**
 * Constructs the payload for Pipeline Labs scraper
 * @param {Array<string>} companyNames - List of company names
 * @param {Object} filters - Dynamic filters
 * @returns {Object} - The constructed payload
 */
export const buildPipelineLabsPayload = (companyNames, filters = {}) => {
    // defaults
    let seniorityIncludes = [...ALLOWED_SENIORITY];
    let seniorityExcludes = [...SENIORITY_EXCLUDES];
    let personTitleIncludes = [...ALLOWED_PERSON_TITLES];
    let personTitleExtraIncludes = [...ALLOWED_EXTRA_TITLES];
    let companyEmployeeSizeIncludes = [
        "1-10", "11-20", "21-50", "51-100", "101-200", "201-500", "501-1000",
        "1001-2000", "2001-5000", "5001-10000", "10001+"
    ];

    let companyLocationCountryIncludes = filters.countries || ["United States", "Canada"];

    // Explicit exclusions if needed, currently not in template but good practice
    // const titleExcludes = ["Assistant", "Intern"];

    if (filters && filters.fetchAll) {
        // Broaden search
        seniorityIncludes = [];
        personTitleIncludes = []; // Clear strict titles for broad search
        personTitleExtraIncludes = [];
        companyEmployeeSizeIncludes = []; // Allow any size
    } else if (filters) {
        // 1. Job Titles
        if (filters.job_titles && Array.isArray(filters.job_titles) && filters.job_titles.length > 0) {
            // STRICT VALIDATION: Only allow titles that are in the allowed lists
            const validTitles = filters.job_titles.filter(t =>
                ALLOWED_PERSON_TITLES.includes(t) || ALLOWED_EXTRA_TITLES.includes(t)
            );

            if (validTitles.length < filters.job_titles.length) {
                console.warn(`[PipelineLabs] Some requested titles were filtered out due to strict policy: ${filters.job_titles.filter(t => !ALLOWED_PERSON_TITLES.includes(t) && !ALLOWED_EXTRA_TITLES.includes(t)).join(', ')}`);
            }

            if (validTitles.length > 0) {
                // MAP titles to the strict API allowed values
                const mappedTitles = validTitles.map(t => {
                    // 1. If it's a direct allowed text, use it
                    if (ALLOWED_PERSON_TITLES.includes(t)) return t;

                    // 2. If it has a mapping, use the mapping
                    if (API_TITLE_MAPPING[t]) return API_TITLE_MAPPING[t];

                    // 3. Fallback: Check if it's in extra titles but NOT mapped (shouldn't happen if config is correct, but safe fallback)
                    // If we send it and it's not allowed, it crashes. So we must be careful.
                    // For now, if no mapping exists, we drop it to be safe, unless it happens to be valid despite our check.
                    return null;
                }).filter(Boolean);

                // Deduplicate
                personTitleIncludes = [...new Set(mappedTitles)];
            } else {
                console.warn("[PipelineLabs] No valid titles provided in filters. Fallback to default ALLOWED_PERSON_TITLES.");
            }
        }

        // 2. Seniority Inference
        if (filters.seniority_input) {
            const text = filters.seniority_input.toLowerCase();
            const inferred = [];
            // Map text to ALLOWED_SENIORITY values only
            if (text.includes('cxo') || text.includes('chief') || text.includes('c-level')) inferred.push('C-Suite');
            if (text.includes('owner') || text.includes('founder')) inferred.push('Owner', 'Founder', 'Partner');
            if (text.includes('director')) inferred.push('Director');
            if (text.includes('vp') || text.includes('president') || text.includes('vice')) inferred.push('VP');
            if (text.includes('manager') || text.includes('head')) inferred.push('Head');

            // Validate inferred against strict list
            const validInferred = inferred.filter(s => ALLOWED_SENIORITY.includes(s));

            if (validInferred.length > 0) seniorityIncludes = validInferred;
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
        personTitleExtraIncludes: personTitleExtraIncludes,
        seniorityIncludes: seniorityIncludes,
        seniorityExcludes: seniorityExcludes,
        companyNameIncludes: cleanNames,
        companyLocationCountryIncludes: companyLocationCountryIncludes,
        companyEmployeeSizeIncludes: companyEmployeeSizeIncludes
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
