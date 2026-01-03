import {
    checkApifyRun,
    getApifyResults,
    startApolloDomainScrape
} from "./apify.js";

// --- DEFAULTS ---


// --- DEFAULTS ---
const defaultTitles = ["ceo", "founder", "owner", "partner", "president", "director", "vp", "head", "principal", "executive"];
const defaultSeniorities = ["c_suite", "executive", "owner", "partner", "vp", "director"];

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
        // Default to Apollo Domain Scraper
        this.provider = config.provider || process.env.LEAD_SCRAPER_PROVIDER || 'apify_apollo_domain';
        this.apifyApiKey = config.apifyApiKey || process.env.APIFY_API_TOKEN;
    }

    /**
     * @param {Array<Object>} companies - List of company objects { company_name, domain }
     * @param {Object} filters - Search filters { job_titles, seniority, ... }
     * @param {Function} logStep - Optional logger function
     * @param {Function} checkCancellation - Optional callback to check for cancellation
     * @returns {Promise<Array<StandardLead>>}
     */


    async fetchLeads(companies, filters = {}, logStep = console.log, checkCancellation = null) {
        if (!companies || companies.length === 0) return { leads: [], disqualified: [] };

        logStep('Lead Finder', `Fetching leads for ${companies.length} companies using ${this.provider}...`);

        switch (this.provider) {
            case 'apify_apollo_domain':
                return this._fetchFromApolloDomain(companies, filters, filters.idempotencyKey, logStep, checkCancellation);
            default:
                throw new Error(`Unknown or deprecated scraper provider: ${this.provider}`);
        }
    }



    /**
     * Internal: Fetch from Apollo Domain Scraper (Apify Actor T1XDXWc1L92AfIJtd)
     * This uses DOMAINS instead of company names for better accuracy.
     * Cost: ~$0.0026 per lead
     */
    async _fetchFromApolloDomain(companies, filters, idempotencyKey = null, logStep = console.log, checkCancellation = null) {
        // Handle arguments shifting if idempotencyKey is function (logStep)
        if (typeof idempotencyKey === 'function') {
            checkCancellation = idempotencyKey; // Not quite right but depends on how it's called
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
            return this._runApolloBatch(batch, filters, index + 1, batchKey, checkCancellation);
        }));

        // Aggregate results
        const rawValid = results.flatMap(r => r.valid);
        const rawDisqualified = results.flatMap(r => r.disqualified);

        console.log(`[ApolloDomain] Retrieved ${rawValid.length} valid leads and ${rawDisqualified.length} disqualified.`);

        // 5. Normalize Data with Tiering
        const validLeads = this._normalizeApolloDomainResults(rawValid, companies, filters);

        // Normalize disqualified too (so they can be saved)
        const disqualifiedLeads = this._normalizeApolloDomainResults(rawDisqualified, companies, filters).map((l, i) => ({
            ...l,
            disqualification_reason: rawDisqualified[i].disqualification_reason
        }));

        return { leads: validLeads, disqualified: disqualifiedLeads };
    }

    /**
     * Helper to run a single batch of domains
     */
    async _runApolloBatch(domains, filters, batchId, idempotencyKey = null, checkCancellation = null) {
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
                // Check for cancellation
                if (checkCancellation && await checkCancellation()) {
                    const { abortApifyRun } = await import("./apify.js");
                    await abortApifyRun(this.apifyApiKey, runId);
                    return [];
                }

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
            // First check: Domain validation (CRITICAL)
            // Second: Job title/function exclusions
            const validItems = [];
            const disqualifiedItems = [];

            // Build set of requested domains for O(1) lookup
            const requestedDomains = new Set(domains.map(d => d.toLowerCase().trim()));
            console.log(`[ApolloDomain] Batch ${batchId}: Validating against domains: ${[...requestedDomains].join(', ')}`);

            items.forEach(item => {
                // STEP 1: STRICT DOMAIN VALIDATION
                const leadDomain = (item.organizationWebsite || item.companyWebsite || "")
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .split('/')[0]
                    .toLowerCase()
                    .trim();

                if (!leadDomain || !requestedDomains.has(leadDomain)) {
                    console.log(`[ApolloDomain] ❌ DOMAIN MISMATCH: ${item.firstName || 'Unknown'} ${item.lastName || ''} from "${leadDomain}" (not in requested: ${[...requestedDomains].slice(0, 5).join(', ')}...)`);
                    disqualifiedItems.push({
                        ...item,
                        disqualification_reason: `Domain mismatch: "${leadDomain}" not in requested list`
                    });
                    return;
                }

                // STEP 2: Job Title Check
                const title = (item.position || item.title || item.personTitle || "").toLowerCase();

                if (!title) {
                    disqualifiedItems.push({ ...item, disqualification_reason: "Missing Job Title" });
                    return;
                }

                // Check Exclusions
                if (filters.excluded_functions && Array.isArray(filters.excluded_functions)) {
                    for (const exclusion of filters.excluded_functions) {
                        const keywords = exclusion.toLowerCase().split('/').map(s => s.trim());
                        for (const kw of keywords) {
                            let isExcluded = false;
                            if (kw.length < 3) {
                                if (new RegExp(`\\b${kw}\\b`, 'i').test(title)) isExcluded = true;
                            } else {
                                if (title.includes(kw)) isExcluded = true;
                            }

                            // EXCEPTION: Protect "Development" role (Real Estate context) from exclusions like "Engineering"
                            if (isExcluded && title.includes('development')) {
                                // console.log(`[ApolloDomain] Protected "Development" role from exclusion "${kw}": ${title}`);
                                isExcluded = false;
                            }

                            // EXCEPTION: Protect "Founder" roles (Co-Founder, Founding Partner) from all exclusions
                            // A Co-Founder of Sales/Marketing is still a decision-maker worth reaching out to
                            if (isExcluded && (title.includes('founder') || title.includes('founding'))) {
                                console.log(`[ApolloDomain] Protected "Founder" role from exclusion "${kw}": ${title}`);
                                isExcluded = false;
                            }

                            if (isExcluded) {
                                disqualifiedItems.push({ ...item, disqualification_reason: `Excluded Function: ${exclusion}` });
                                return;
                            }
                        }
                    }
                }

                // Check Industry (if exclusions provided)
                const companyIndustry = (item.organizationIndustry || item.industry || "").toLowerCase();
                if (filters.excludedIndustries && Array.isArray(filters.excludedIndustries) && companyIndustry) {
                    for (const excluded of filters.excludedIndustries) {
                        const excludedLower = excluded.toLowerCase().trim();
                        if (excludedLower && companyIndustry.includes(excludedLower)) {
                            console.log(`[ApolloDomain] Excluded by industry "${excluded}": ${item.organizationName} (${companyIndustry})`);
                            disqualifiedItems.push({ ...item, disqualification_reason: `Excluded Industry: ${excluded}` });
                            return;
                        }
                    }
                }

                validItems.push(item);
            });

            console.log(`[ApolloDomain] Batch ${batchId}: ${validItems.length} valid, ${disqualifiedItems.length} disqualified.`);

            return { valid: validItems, disqualified: disqualifiedItems };

        } catch (error) {
            console.error(`[ApolloDomain] Batch ${batchId} failed:`, error.message);
            return []; // Return empty array so other batches can proceed
        }
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

            // --- PHONE NUMBER PARSING ---
            let phoneNumbers = [];
            // Strategy: Gather all possible phone fields
            if (item.phone) phoneNumbers.push({ type: 'generic', number: item.phone });
            if (item.phone_numbers && Array.isArray(item.phone_numbers)) {
                // If it's an array of objects or strings, normalize it
                item.phone_numbers.forEach(p => {
                    if (typeof p === 'string') phoneNumbers.push({ type: 'other', number: p });
                    else if (p.raw_number) phoneNumbers.push({ type: p.type || 'other', number: p.raw_number });
                    else if (p.number) phoneNumbers.push({ type: p.type || 'other', number: p.number });
                });
            }
            // Check for direct fields in standard Apify/Apollo schema
            if (item.mobile_phone) phoneNumbers.push({ type: 'mobile', number: item.mobile_phone });
            if (item.corporate_phone) phoneNumbers.push({ type: 'work', number: item.corporate_phone });
            if (item.home_phone) phoneNumbers.push({ type: 'home', number: item.home_phone });

            // Deduplicate
            phoneNumbers = [...new Map(phoneNumbers.map(item => [item.number, item])).values()];

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
                phone_numbers: phoneNumbers, // NEW: Added phone numbers
                raw_data: item
            };
        });
    }


}

