import {
    startApifyScrape,
    checkApifyRun,
    getApifyResults,
    startApolloDomainScrape
} from "./apify.js";
import {
    startScraperCityScrape,
    checkScraperCityRun,
    getScraperCityResults,
    buildApolloSearchUrl
} from "./scrapercity.js";

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
 * This allows swapping the underlying provider (PipelineLabs, Apollo Domain Scraper, ScraperCity)
 */
export class LeadScraperService {
    constructor(config = {}) {
        this.config = config;
        // Default to Apollo Domain Scraper - best quality + instant + cheap ($0.0026/lead)
        this.provider = config.provider || process.env.LEAD_SCRAPER_PROVIDER || 'apify_apollo_domain';
        this.apifyApiKey = config.apifyApiKey || process.env.APIFY_API_TOKEN;
        this.scraperCityApiKey = config.scraperCityApiKey || process.env.SCRAPERCITY_API_KEY;
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
            case 'apify_apollo_domain':
                return this._fetchFromApolloDomain(companies, filters);
            case 'scrapercity_apollo':
                return this._fetchFromScraperCity(companies, filters);
            default:
                throw new Error(`Unknown scraper provider: ${this.provider}`);
        }
    }

    /**
     * Internal: Fetch from Apify PipelineLabs Actor (legacy)
     */
    async _fetchFromApify(companies, filters) {
        // 1. Prepare Names
        const targetNames = companies.map(c => c.company_name).filter(n => n && n.trim().length > 0);

        // 2. Start Job
        const runId = await startApifyScrape(this.apifyApiKey, targetNames, filters);

        // 3. Poll for Completion
        const POLL_INTERVAL = 5000;
        const MAX_WAIT = 600; // 10 minutes
        let isComplete = false;
        let datasetId = null;
        let attempts = 0;

        while (!isComplete && attempts < MAX_WAIT) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            const statusRes = await checkApifyRun(this.apifyApiKey, runId);

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
        const rawItems = await getApifyResults(this.apifyApiKey, datasetId);

        // 5. Normalize Data
        return this._normalizeApifyResults(rawItems, companies);
    }

    /**
     * Internal: Fetch from Apollo Domain Scraper (Apify Actor T1XDXWc1L92AfIJtd)
     * This uses DOMAINS instead of company names for better accuracy.
     * Cost: ~$0.0026 per lead
     */
    async _fetchFromApolloDomain(companies, filters) {
        // 1. Extract domains from companies
        const domains = companies
            .map(c => c.domain || c.website)
            .filter(d => d && d.trim().length > 0)
            .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').trim());

        if (domains.length === 0) {
            console.warn('[ApolloDomain] No valid domains provided. Falling back to company names search.');
            // Could fallback to PipelineLabs here, but better to fail explicitly
            return [];
        }

        console.log(`[ApolloDomain] Searching ${domains.length} domains: ${domains.slice(0, 5).join(', ')}...`);

        // 2. Start Job
        const runId = await startApolloDomainScrape(this.apifyApiKey, domains, filters);

        if (!runId) {
            throw new Error('Failed to start Apollo Domain scrape - no run ID returned');
        }

        // 3. Poll for Completion
        const POLL_INTERVAL = 5000;
        const MAX_ATTEMPTS = 120; // 10 minutes max
        let isComplete = false;
        let datasetId = null;
        let attempts = 0;

        while (!isComplete && attempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            const statusRes = await checkApifyRun(this.apifyApiKey, runId);

            console.log(`[ApolloDomain] Poll ${attempts + 1}: Status = ${statusRes.status}`);

            if (statusRes.status === 'SUCCEEDED') {
                isComplete = true;
                datasetId = statusRes.datasetId;
            } else if (statusRes.status === 'FAILED' || statusRes.status === 'ABORTED') {
                throw new Error(`Apollo Domain run failed with status: ${statusRes.status}`);
            }
            attempts++;
        }

        if (!datasetId) {
            throw new Error('Apollo Domain scrape timed out or returned no dataset.');
        }

        // 4. Fetch Results
        const rawItems = await getApifyResults(this.apifyApiKey, datasetId);

        // Filter out the info message row (first row is often a log message)
        const actualLeads = rawItems.filter(item => item.email || item.firstName);

        console.log(`[ApolloDomain] Retrieved ${actualLeads.length} leads with emails.`);

        // 5. Normalize Data
        return this._normalizeApolloDomainResults(actualLeads, companies);
    }

    /**
     * Internal: Fetch from ScraperCity Apollo Scraper
     */
    async _fetchFromScraperCity(companies, filters) {
        // 1. Build company names
        const targetNames = companies.map(c => c.company_name).filter(n => n && n.trim().length > 0);

        if (targetNames.length === 0) {
            console.warn('[ScraperCity] No valid company names provided.');
            return [];
        }

        // 2. Build Apollo Search URL
        const apolloUrl = buildApolloSearchUrl(targetNames, filters);
        console.log(`[ScraperCity] Apollo URL: ${apolloUrl.substring(0, 100)}...`);

        // 3. Calculate count: aim for ~3-5 leads per company
        const targetCount = Math.min(targetNames.length * 5, 100); // Max 100 per batch

        // 4. Start Scrape
        const runId = await startScraperCityScrape(this.scraperCityApiKey, apolloUrl, targetCount);

        // 5. Poll for Completion
        const POLL_INTERVAL = 5000;
        const MAX_ATTEMPTS = 120; // 10 minutes max
        let isComplete = false;
        let attempts = 0;

        while (!isComplete && attempts < MAX_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
            const statusRes = await checkScraperCityRun(this.scraperCityApiKey, runId);

            console.log(`[ScraperCity] Poll ${attempts + 1}: Status = ${statusRes.status || statusRes.state}`);

            const status = (statusRes.status || statusRes.state || '').toLowerCase();
            if (status === 'completed' || status === 'succeeded' || status === 'done') {
                isComplete = true;
            } else if (status === 'failed' || status === 'error') {
                throw new Error(`ScraperCity run failed: ${statusRes.message || 'Unknown error'}`);
            }
            attempts++;
        }

        if (!isComplete) {
            throw new Error('ScraperCity scrape timed out.');
        }

        // 6. Download Results
        const rawItems = await getScraperCityResults(this.scraperCityApiKey, runId);
        console.log(`[ScraperCity] Downloaded ${rawItems.length} raw leads.`);

        // 7. Normalize Data
        return this._normalizeScraperCityResults(rawItems, companies);
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
        });
    }

    /**
     * Normalize Apollo Domain Scraper results to Standard Lead format
     * Output format: firstName, lastName, email, position, linkedinUrl, organizationName, organizationWebsite
     */
    _normalizeApolloDomainResults(rawItems, qualifiedCompanies) {
        return rawItems.map(item => {
            const scrapedCompany = item.organizationName;
            const companyDomain = item.organizationWebsite
                ? item.organizationWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '')
                : '';

            // Match to our qualified companies
            const originalCompany = qualifiedCompanies.find(c =>
                (c.domain && companyDomain && companyDomain.includes(c.domain)) ||
                (scrapedCompany && c.company_name && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
            ) || {};

            return {
                first_name: item.firstName || '',
                last_name: item.lastName || '',
                email: item.email || '',
                personal_email: item.personal_email || '',
                title: item.position || '',
                linkedin_url: item.linkedinUrl || '',
                company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                company_domain: companyDomain || originalCompany.domain || '',
                company_website: item.organizationWebsite || originalCompany.website || '',
                company_profile: originalCompany.company_profile || '',
                city: item.city || '',
                state: item.state || '',
                country: item.country || '',
                seniority: item.seniority || '',
                industry: item.organizationIndustry || '',
                company_size: item.organizationSize || '',
                raw_data: item
            };
        });
    }

    /**
     * Normalize ScraperCity Apollo results to Standard Lead format
     */
    _normalizeScraperCityResults(rawItems, qualifiedCompanies) {
        // ScraperCity Apollo data shape (based on Apollo.io data):
        // { first_name, last_name, email, title, linkedin_url, organization_name, ... }
        return rawItems.map(item => {
            const scrapedCompany = item.organization_name || item.company || item.orgName;
            const companyDomain = item.organization_website || item.website_url;

            // Match to our qualified companies
            const originalCompany = qualifiedCompanies.find(c =>
                (c.domain && companyDomain && companyDomain.includes(c.domain)) ||
                (scrapedCompany && c.company_name && c.company_name.toLowerCase().includes(scrapedCompany.toLowerCase()))
            ) || {};

            return {
                first_name: item.first_name || '',
                last_name: item.last_name || '',
                email: item.email || item.primary_email || '',
                title: item.title || item.headline || '',
                linkedin_url: item.linkedin_url || item.linkedin || '',
                company_name: scrapedCompany || originalCompany.company_name || 'Unknown',
                company_domain: companyDomain || originalCompany.domain || '',
                company_website: item.organization_website || originalCompany.website || '',
                company_profile: originalCompany.company_profile || '',
                city: item.city || item.location || '',
                seniority: item.seniority || '',
                phone: item.phone || item.mobile_phone || item.corporate_phone || '',
                raw_data: item
            };
        });
    }
}

