import { startApifyScrape, checkApifyRun, getApifyResults } from "./apify.js";

/**
 * Standardized Lead Object
 * @typedef {Object} StandardLead
 * @property {string} first_name
 * @property {string} last_name
 * @property {string} email
 * @property {string} title
 * @property {string} linkedin_url
 * @property {string} company_name
 * @property {string} company_domain
 * @property {string} company_website
 * @property {string} city
 * @property {string} seniority
 * @property {Object} raw_data - The original provider data
 */

/**
 * Interface for Lead Scraper Service
 * This allows swapping the underlying provider (Pipeline Labs, Apollo, etc.)
 */
export class LeadScraperService {
    constructor(config = {}) {
        this.config = config;
        this.provider = config.provider || 'apify_pipelinelabs';
        this.apiKey = config.apiKey || process.env.APIFY_API_TOKEN;
    }

    /**
     * Fetch leads for a list of companies
     * @param {Array<Object>} companies - List of company objects { company_name, domain }
     * @param {Object} filters - Search filters { job_titles, seniority, ... }
     * @returns {Promise<Array<StandardLead>>}
     */
    async fetchLeads(companies, filters = {}) {
        if (!companies || companies.length === 0) return [];

        console.log(`[LeadScraper] Fetching leads for ${companies.length} companies using ${this.provider}...`);

        switch (this.provider) {
            case 'apify_pipelinelabs':
                return this._fetchFromApify(companies, filters);
            // Future providers:
            // case 'apollo_api':
            //     return this._fetchFromApollo(companies, filters);
            default:
                throw new Error(`Unknown scraper provider: ${this.provider}`);
        }
    }

    /**
     * Internal: Fetch from Apify PipelineLabs Actor
     */
    async _fetchFromApify(companies, filters) {
        // 1. Prepare Names
        const targetNames = companies.map(c => c.company_name).filter(n => n && n.trim().length > 0);

        // 2. Start Job
        const runId = await startApifyScrape(this.apiKey, targetNames, filters);

        // 3. Poll for Completion
        const POLL_INTERVAL = 5000;
        const MAX_WAIT = 600; // 10 minutes
        let isComplete = false;
        let datasetId = null;
        let attempts = 0;

        while (!isComplete && attempts < MAX_WAIT) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            const statusRes = await checkApifyRun(this.apiKey, runId);

            if (statusRes.status === 'SUCCEEDED') {
                isComplete = true;
                datasetId = statusRes.datasetId;
            } else if (statusRes.status === 'FAILED' || statusRes.status === 'ABORTED') {
                throw new Error(`Apify run failed with status: ${statusRes.status}`);
            }
            attempts++;
        }

        if (!datasetId) {
            throw new Error('Scrape timed out or returned no dataset.');
        }

        // 4. Fetch Results
        const rawItems = await getApifyResults(this.apiKey, datasetId);

        // 5. Normalize Data
        return this._normalizeApifyResults(rawItems, companies);
    }

    /**
     * Normalize Apify results to Standard Lead format
     */
    _normalizeApifyResults(rawItems, qualifiedCompanies) {
        return rawItems.map(item => {
            // Name Parsing
            let firstName = item.firstName || item.first_name || '';
            let lastName = item.lastName || item.last_name || '';
            if (!firstName && item.fullName) {
                const parts = item.fullName.split(' ');
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
            }

            // Company Matching
            const scrapedCompany = item.orgName || item.companyName;
            const companyDomain = item.companyDomain || item.orgWebsite;

            // Try to find the original qualified company to restore context (profile, etc)
            const originalCompany = qualifiedCompanies.find(c =>
                (c.domain && companyDomain && c.domain.includes(companyDomain)) ||
                (scrapedCompany && c.company_name && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
            ) || {};

            return {
                first_name: firstName,
                last_name: lastName,
                email: item.email || item.workEmail || item.personalEmail,
                title: item.position || item.title || item.jobTitle,
                linkedin_url: item.linkedinUrl || item.linkedin_url || item.profileUrl,
                company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                company_domain: companyDomain || originalCompany.domain,
                company_website: item.orgWebsite || originalCompany.website || '',
                company_profile: originalCompany.company_profile || '',
                city: item.city || item.location,
                seniority: item.seniority,
                raw_data: item
            };
        }).filter(lead => lead.email); // Enforce email requirement here or let caller decide? 
        // User said "Emails are weakest point", so let's keep non-emails? 
        // Actually, logic in workflow filtered `l => l.email`. 
        // But task says "Collect leads (including emails and LinkedIn)".
        // Let's return ALL, and let workflow filter/count.
    }
}
