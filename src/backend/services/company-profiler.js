import { scanSiteStructure, scrapeSpecificPages } from './apify.js';
import { OutreachService } from './outreach-service.js';
import { query } from '../../../db/index.js';

/**
 * CompanyProfiler Service
 * Handles deep sitemap scanning and page scraping to build robust company profiles.
 */
export const CompanyProfiler = {
    /**
     * Deep enrich a single company by name/domain
     */
    async enrichByDomain(domain, companyName) {
        const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
        if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

        console.log(`[Profiler] Starting deep enrichment for ${companyName} (${domain})`);

        // 1. Scan Structure
        const scanResult = await scanSiteStructure(domain, APIFY_TOKEN);
        if (!scanResult || scanResult.links.length === 0) {
            throw new Error('No links found during site scan');
        }

        // 2. Select Pages
        const filtered = this._selectBestPages(scanResult.links, companyName);
        console.log(`[Profiler] Selected ${filtered.length} pages for ${companyName}`);

        // 3. Scrape
        const content = await scrapeSpecificPages(filtered, APIFY_TOKEN);
        if (!content || content.length < 500) {
            throw new Error('Insufficient content scraped from site');
        }

        // 4. Update Database for all leads of this company
        await query(
            `UPDATE leads 
             SET company_profile = $1, updated_at = NOW() 
             WHERE company_name ILIKE $2 OR custom_data::text LIKE $3`,
            [content, `%${companyName}%`, `%${domain}%`]
        );

        return {
            contentLength: content.length,
            pageCount: filtered.length,
            status: 'success'
        };
    },

    /**
     * Internal Page Selection Logic (Regex-based)
     */
    _selectBestPages(links, companyName) {
        // High priority: Strategy, About, Portfolio, Investment
        const priorityPatterns = [
            /strategy|approach|investment|thesis|philosophy/i,
            /portfolio|projects|properties|assets|real-estate/i,
            /about|company|who-we-are|profile|history/i,
            /team|leadership|management|executive/i,
            /residential|multifamily|housing|development/i
        ];

        let priority = links.filter(l => priorityPatterns.some(p => p.test(l)));

        // Remove junk
        priority = priority.filter(l =>
            !/news|press|career|job|legal|privacy|login|signin|portal|events|media|report|download/i.test(l)
        );

        // Limit to 40
        if (priority.length > 40) priority = priority.slice(0, 40);

        // Fallback: Just return homepage and a few others if none matched
        if (priority.length < 3) {
            return links.slice(0, 10);
        }

        return priority;
    }
};
