/**
 * Contact Enrichment Service
 * Uses Google search to find LinkedIn URLs and emails for contacts
 */
import { performGoogleSearch } from './apify.js';

/**
 * Parse LinkedIn URL from Google search results
 */
function parseLinkedInUrl(results) {
    for (const result of results) {
        const link = result.link || '';
        // Match LinkedIn profile URLs
        if (link.includes('linkedin.com/in/')) {
            return link.split('?')[0]; // Remove query params
        }
    }
    return null;
}

/**
 * Parse email from snippets (less reliable)
 */
function parseEmailFromResults(results) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    for (const result of results) {
        const snippet = result.snippet || '';
        const matches = snippet.match(emailRegex);
        if (matches && matches.length > 0) {
            // Filter out common fake emails
            const validEmails = matches.filter(email =>
                !email.includes('example.com') &&
                !email.includes('email@') &&
                !email.includes('@email')
            );
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
 * @param {string} companyName - Company name for context
 * @returns {Promise<{linkedin: string|null, email: string|null, searchResults: Array}>}
 */
export async function enrichContact(personName, companyName) {
    console.log(`[Enrichment] Searching for ${personName} at ${companyName}...`);

    const results = {
        linkedin: null,
        email: null,
        searchResults: [],
        queries: []
    };

    try {
        // Strategy 1: Direct LinkedIn search
        const linkedInQuery = `"${personName}" "${companyName}" LinkedIn`;
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

        results.email = parseEmailFromResults(emailResults);

        console.log(`[Enrichment] Results for ${personName}: LinkedIn=${results.linkedin ? 'Found' : 'Not found'}, Email=${results.email ? 'Found' : 'Not found'}`);

        return results;

    } catch (e) {
        console.error(`[Enrichment] Error enriching ${personName}:`, e.message);
        return { ...results, error: e.message };
    }
}

/**
 * Enrich multiple contacts in batch
 * @param {Array<{name: string, companyName: string}>} contacts
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

        const enrichment = await enrichContact(contact.name, contact.companyName);
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
