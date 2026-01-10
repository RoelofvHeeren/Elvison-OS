/**
 * Contact Enrichment Service
 * Uses Google search to find LinkedIn URLs and emails for contacts
 */
import { performGoogleSearch } from './apify.js';

/**
 * Parse LinkedIn URL from Google search results
 * Normalizes to www.linkedin.com to avoid regional 404s
 */
function parseLinkedInUrl(results) {
    for (const result of results) {
        let link = result.link || '';
        // Match LinkedIn profile URLs (avoid posts, jobs, etc if possible)
        if (link.includes('linkedin.com/in/')) {
            // Normalize to www.linkedin.com to handle regional redirects (e.g. nl.linkedin.com -> www)
            link = link.replace(/:\/\/[a-z]{2,3}\.linkedin\.com/, '://www.linkedin.com');
            return link.split('?')[0]; // Remove query params
        }
    }
    return null;
}

/**
 * Parse email from snippets with strict filtering
 */
function parseEmailFromResults(results, companyDomain) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const genericPrefixes = ['info', 'sales', 'contact', 'support', 'admin', 'jobs', 'careers', 'office', 'hello', 'enquiries', 'mail', 'team'];

    for (const result of results) {
        const snippet = result.snippet || '';
        const matches = snippet.match(emailRegex);
        if (matches && matches.length > 0) {
            // Filter emails
            const validEmails = matches.filter(email => {
                const lowerEmail = email.toLowerCase();

                // 1. Block generic prefixes
                const prefix = lowerEmail.split('@')[0];
                if (genericPrefixes.includes(prefix)) return false;

                // 2. Block common fake domains
                if (lowerEmail.includes('example.com') || lowerEmail.includes('email@')) return false;

                // 3. STRICT: Enforce domain match if provided
                if (companyDomain) {
                    const cleanCompanyDomain = companyDomain.replace(/^www\./, '').toLowerCase();
                    const emailDomain = lowerEmail.split('@')[1];
                    // Check if email domain ends with company domain (handles subdomains too)
                    if (!emailDomain.endsWith(cleanCompanyDomain)) return false;
                }

                return true;
            });

            if (validEmails.length > 0) {
                return validEmails[0];
            }
        }
    }
    return null;
}

/**
 * Enrich a single contact via Google search
 * @param {string} personName - Full name of the person
 * @param {string} companyDomain - Domain for strict email matching
 * @returns {Promise<{linkedin: string|null, email: string|null, searchResults: Array}>}
 */
export async function enrichContact(personName, companyName, companyDomain = null) {
    console.log(`[Enrichment] Searching for ${personName} at ${companyName} (${companyDomain || 'no domain'})...`);

    const results = {
        linkedin: null,
        email: null,
        searchResults: [],
        queries: []
    };

    try {
        // Strategy 1: Direct LinkedIn search (Restricted to profile pages)
        // Using site:linkedin.com/in/ forces profile results and reduces 404s/garbage
        const linkedInQuery = `"${personName}" "${companyName}" site:linkedin.com/in/`;
        results.queries.push(linkedInQuery);

        const linkedInResults = await performGoogleSearch(linkedInQuery);
        results.searchResults.push(...linkedInResults);

        results.linkedin = parseLinkedInUrl(linkedInResults);

        // If no LinkedIn found, try site-specific search
        if (!results.linkedin) {
            const siteQuery = `"${personName}" site:linkedin.com`;
            results.queries.push(siteQuery);

            const siteResults = await performGoogleSearch(siteQuery);
            results.searchResults.push(...siteResults);

            results.linkedin = parseLinkedInUrl(siteResults);
        }

        // Strategy 2: Email search (less reliable but worth trying)
        const emailQuery = `"${personName}" "${companyName}" email`;
        results.queries.push(emailQuery);

        const emailResults = await performGoogleSearch(emailQuery);
        results.searchResults.push(...emailResults);

        results.email = parseEmailFromResults(emailResults, companyDomain);

        console.log(`[Enrichment] Results for ${personName}: LinkedIn=${results.linkedin ? 'Found' : 'Not found'}, Email=${results.email ? 'Found' : 'Not found'}`);

        return results;

    } catch (e) {
        console.error(`[Enrichment] Error enriching ${personName}:`, e.message);
        return { ...results, error: e.message };
    }
}

/**
 * Enrich multiple contacts in batch
 * @param {Array<{name: string, companyName: string, companyDomain?: string}>} contacts
 * @param {Function} onProgress - Callback for progress updates
 * @returns {Promise<Array>}
 */
export async function enrichContactsBatch(contacts, onProgress = null) {
    const results = [];

    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];

        if (onProgress) {
            onProgress({
                current: i + 1,
                total: contacts.length,
                name: contact.name
            });
        }

        const enrichment = await enrichContact(contact.name, contact.companyName, contact.companyDomain);
        results.push({
            ...contact,
            ...enrichment
        });

        // Rate limiting - 1 second between searches
        if (i < contacts.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return results;
}

/**
 * Quick check if a person has a LinkedIn profile
 * @param {string} personName
 * @param {string} companyName
 * @returns {Promise<string|null>} LinkedIn URL or null
 */
export async function findLinkedIn(personName, companyName) {
    const result = await enrichContact(personName, companyName);
    return result.linkedin;
}

export default {
    enrichContact,
    enrichContactsBatch,
    findLinkedIn
};
