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
     * @param {Function} logStep - Optional logger function
     * @returns {Promise<Array<StandardLead>>}
     */
    async fetchLeads(companies, filters = {}, logStep = console.log) {
        if (!companies || companies.length === 0) return [];

        logStep('Lead Finder', `Fetching leads for ${companies.length} companies using ${this.provider}...`);

        switch (this.provider) {
            case 'apify_pipelinelabs':
                return this._fetchFromApify(companies, filters);
            case 'apify_apollo_domain':
                // Check if filters.idempotencyKey exists if argument is missing
                return this._fetchFromApolloDomain(companies, filters, filters.idempotencyKey, logStep);
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

            if (statusRes.status === 'SUCCEEDED' || statusRes.status === 'ABORTED') {
                isComplete = true;
                datasetId = statusRes.datasetId;
                if (statusRes.status === 'ABORTED') console.warn('[PipelineLabs] Run ABORTED (likely cost limit). Fetching partial results.');
            } else if (statusRes.status === 'FAILED') {
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
    async _fetchFromApolloDomain(companies, filters, idempotencyKey = null, logStep = console.log) {
        // Handle arguments shifting if idempotencyKey is function (logStep)
        if (typeof idempotencyKey === 'function') {
            logStep = idempotencyKey;
            idempotencyKey = null;
        }

        // Note: idempotencyKey is also available in filters from fetchLeads but passing explicit arg is clearer
        if (idempotencyKey) filters.idempotencyKey = idempotencyKey;

        // 1. Extract domains from companies
        logStep('Lead Finder', `[Apollo] Processing ${companies.length} companies...`);

        // Helper: Check if a string looks like a valid domain (has dot, no spaces)
        const looksLikeDomain = (str) => {
            if (!str || typeof str !== 'string') return false;
            const trimmed = str.trim();
            return trimmed.includes('.') && !trimmed.includes(' ') && trimmed.length > 3;
        };

        // Helper: Clean a URL/domain string to bare domain
        const cleanDomain = (str) => {
            if (!str) return null;
            return str.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].trim().toLowerCase();
        };

        // DEBUG: Log the raw company data to see what we're working with
        companies.forEach((c, i) => {
            console.log(`[ApolloDomain] Company ${i + 1}: name="${c.company_name}", domain="${c.domain}", website="${c.website}"`);
        });

        // Extract domains with smart fallback:
        // - If `domain` looks like an actual domain, use it
        // - Otherwise, fall back to `website`
        const rawDomains = companies.map(c => {
            // Check if domain field actually contains a domain
            if (looksLikeDomain(c.domain)) {
                return cleanDomain(c.domain);
            }
            // Fall back to website
            if (looksLikeDomain(c.website)) {
                return cleanDomain(c.website);
            }
            // Try cleaning website even if it has protocol
            if (c.website && c.website.includes('.')) {
                return cleanDomain(c.website);
            }
            console.warn(`[ApolloDomain] No valid domain found for "${c.company_name}"`);
            return null;
        }).filter(Boolean);

        console.log(`[ApolloDomain] Raw domains extracted: ${JSON.stringify(rawDomains)}`);

        const domains = rawDomains
            .filter(d => d && d.trim().length > 0 && d.includes('.') && !d.includes(' ')) // Strict: Must have dot, no spaces
            .map(d => d.replace(/^https?:\/\//, '').replace(/^www\./, '').trim().toLowerCase());

        console.log(`[ApolloDomain] Filtered domains (after validation): ${JSON.stringify(domains)}`);

        // Deduplicate
        const cleanDomains = [...new Set(domains)];
        console.log(`[ApolloDomain] Clean domains (deduplicated): ${JSON.stringify(cleanDomains)}`);

        if (cleanDomains.length === 0) {
            logStep('Lead Finder', '❌ No valid domains provided! Check if Company Profiler is returning "domain" field.');
            return [];
        }

        // 2. Batch Processing (Actor limit: 10 domains/run)
        const BATCH_SIZE = 10;
        const batches = [];
        for (let i = 0; i < cleanDomains.length; i += BATCH_SIZE) {
            batches.push(cleanDomains.slice(i, i + BATCH_SIZE));
        }

        console.log(`[ApolloDomain] Processing ${cleanDomains.length} domains in ${batches.length} batches (limit 10/run)...`);

        // Run batches in parallel
        // Fix: Pass idempotencyKey with batch suffix to avoid collisions
        const results = await Promise.all(batches.map((batch, index) => {
            const batchKey = idempotencyKey ? `${idempotencyKey}_batch_${index + 1}` : null;
            return this._runApolloBatch(batch, filters, index + 1, batchKey);
        }));

        // Aggregate results
        const rawItems = results.flat();

        // Filter out the info message row (first row is often a log message)
        const actualLeads = rawItems.filter(item => item.email || item.firstName);

        console.log(`[ApolloDomain] Retrieved ${actualLeads.length} total leads with emails from all batches.`);

        // 5. Normalize Data with Tiering
        return this._normalizeApolloDomainResults(actualLeads, companies, filters);
    }

    /**
     * Helper to run a single batch of domains
     */
    async _runApolloBatch(domains, filters, batchId, idempotencyKey = null) {
        console.log(`[ApolloDomain] Starting Batch ${batchId} with ${domains.length} domains (Strict Filtering Active). Key: ${idempotencyKey || 'N/A'}`);

        // Log Exclusions
        if (filters.excluded_functions?.length) {
            console.log(`[ApolloDomain] Exclusions applied: ${filters.excluded_functions.join(', ')}`);
        }

        try {
            // Start Job
            const runId = await startApolloDomainScrape(this.apifyApiKey, domains, filters, idempotencyKey);

            if (!runId) {
                throw new Error(`Batch ${batchId}: No run ID returned`);
            }

            // Poll for Completion
            const POLL_INTERVAL = 5000;
            const MAX_ATTEMPTS = 120; // 10 minutes max
            let isComplete = false;
            let datasetId = null;
            let attempts = 0;

            while (!isComplete && attempts < MAX_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
                // Note: We swallow errors in poll check to avoid breaking Promise.all, or handle them?
                // checkApifyRun throws if request fails
                const statusRes = await checkApifyRun(this.apifyApiKey, runId);

                // logging only every 3rd poll to reduce noise with multiple batches
                if (attempts % 3 === 0) {
                    console.log(`[ApolloDomain] Batch ${batchId} Poll ${attempts + 1}: Status = ${statusRes.status}`);
                }

                if (statusRes.status === 'SUCCEEDED' || statusRes.status === 'ABORTED') {
                    isComplete = true;
                    datasetId = statusRes.datasetId;
                    if (statusRes.status === 'ABORTED') console.warn(`[ApolloDomain] Batch ${batchId} ABORTED (likely cost limit). Fetching partial results.`);
                } else if (statusRes.status === 'FAILED') {
                    throw new Error(`Run failed with status: ${statusRes.status}`);
                }
                attempts++;
            }

            if (!datasetId) {
                throw new Error(`Batch ${batchId} timed out or no dataset.`);
            }

            // Fetch Results
            const items = await getApifyResults(this.apifyApiKey, datasetId);
            console.log(`[ApolloDomain] Batch ${batchId} raw items: ${items.length}`);

            // --- STRICT FILTERING LAYER ---
            // Deprioritize or Remove Excluded Functions
            const validItems = items.filter(item => {
                const title = (item.title || item.personTitle || "").toLowerCase();
                if (!title) return false;

                // Check Exclusions
                if (filters.excluded_functions && Array.isArray(filters.excluded_functions)) {
                    for (const exclusion of filters.excluded_functions) {
                        // "HR / People" -> ["hr", "people"]
                        const keywords = exclusion.toLowerCase().split('/').map(s => s.trim());
                        // If title matches any keyword, exclude
                        // Use word boundary check for better accuracy e.g. "hr" vs "chris"
                        for (const kw of keywords) {
                            if (kw.length < 3) {
                                // Strict word check for short acronyms
                                const regex = new RegExp(`\\b${kw}\\b`, 'i');
                                if (regex.test(title)) return false;
                            } else {
                                if (title.includes(kw)) return false;
                            }
                        }
                    }
                }
                return true;
            });

            console.log(`[ApolloDomain] Batch ${batchId} valid items after exclusions: ${validItems.length} (Dropped ${items.length - validItems.length})`);

            return validItems;

        } catch (error) {
            console.error(`[ApolloDomain] Batch ${batchId} failed:`, error.message);
            return []; // Return empty array so other batches can proceed
        }
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
    _normalizeApolloDomainResults(rawItems, qualifiedCompanies, filters = {}) {
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

            // --- TIERING LOGIC ---
            let tier = 3; // Default: Valid Company Match
            const hasEmail = !!item.email;
            const title = (item.position || "").toLowerCase();

            // Check Title Match (High Value)
            // If filters.job_titles is provided, checking against it increases score
            let titleMatch = false;
            if (filters.job_titles && filters.job_titles.length > 0) {
                titleMatch = filters.job_titles.some(t => title.includes(t.toLowerCase()));
            } else {
                // Heuristic: C-Level or VP or Partner is good
                titleMatch = /ceo|founder|partner|president|director|vp|vice president|chief/.test(title);
            }

            if (hasEmail && titleMatch) {
                tier = 1; // Perfect: Email + Good Title
            } else if (titleMatch) {
                tier = 2; // Good: Good Title but no Email (or Email but weak title? No, title drives relevance)
            } else if (hasEmail) {
                tier = 2; // Good: Has Email (actionable) but title might be generic or non-exec
            }

            // Tier 3 is remaining (No Email + Weak Title)

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
                personTitle: (filters.job_titles && filters.job_titles.length > 0) ? filters.job_titles : defaultTitles,
                seniority: (filters.seniority && filters.seniority.length > 0) ? filters.seniority : defaultSeniorities,
                industry: item.organizationIndustry || '',
                company_size: item.organizationSize || '',
                tier: tier, // NEW
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

