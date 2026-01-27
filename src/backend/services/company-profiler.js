import { scanSiteStructure, scrapeSpecificPages } from './apify.js';
import { OutreachService } from './outreach-service.js';
import { query } from '../../../db/index.js';
import { CircuitBreaker } from '../../utils/circuit-breaker.js';

// Circuit breaker for Apify to prevent cascading failures
const apifyBreaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 120000,
    monitoringPeriod: 60000
});

/**
 * CompanyProfiler Service V5
 * Handles deep sitemap scanning and page scraping to build robust company profiles.
 * Enhanced with ICP-specific page targeting and circuit breaker pattern.
 */
export const CompanyProfiler = {
    /**
     * Deep enrich a single company by name/domain
     * @param {string} domain - Company website domain
     * @param {string} companyName - Company name
     * @param {string} icpType - e.g. "Family Office", "Investment Fund"
     */
    async enrichByDomain(domain, companyName, icpType = '') {
        const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_API_KEY;
        if (!APIFY_TOKEN) throw new Error('Missing APIFY_API_TOKEN');

        console.log(`[Profiler] Starting deep enrichment for ${companyName} (${domain}) [ICP: ${icpType}]`);

        // Execute via Circuit Breaker
        return await apifyBreaker.execute(async () => {
            // 1. Scan Structure
            const scanResult = await scanSiteStructure(domain, APIFY_TOKEN);
            if (!scanResult || scanResult.links.length === 0) {
                // Not a fatal error, just no links - don't trip breaker
                console.warn(`[Profiler] No links found for ${domain}`);
                throw new Error('No links found during site scan');
            }

            // 2. Select Pages (ICP-Aware)
            const filtered = this._selectBestPages(scanResult.links, companyName, icpType);
            console.log(`[Profiler] Selected ${filtered.length} pages for ${companyName}`);

            if (filtered.length === 0) {
                throw new Error('No relevant pages found to scrape');
            }

            // 3. Scrape
            const content = await scrapeSpecificPages(filtered, APIFY_TOKEN);
            if (!content || content.length < 500) {
                throw new Error('Insufficient content scraped from site');
            }

            // 4. Update Database for all leads of this company
            // Append explicit timestamp to verify freshness
            const profileHeader = `[Enriched: ${new Date().toISOString()}]\n\n`;

            await query(
                `UPDATE leads 
                 SET company_profile = $1, 
                     updated_at = NOW(),
                     outreach_status = 'NEEDS_RESEARCH',
                     outreach_reason = 'profile_enriched_pending_regen'
                 WHERE company_name ILIKE $2 OR custom_data::text LIKE $3`,
                [profileHeader + content, `%${companyName}%`, `%${domain}%`]
            );

            return {
                contentLength: content.length,
                pageCount: filtered.length,
                status: 'success'
            };
        });
    },

    /**
     * Internal Page Selection Logic (ICP-Aware)
     */
    _selectBestPages(links, companyName, icpType) {
        const lowerIcp = (icpType || '').toLowerCase();
        let priorityPatterns = [];

        // BASE PATTERNS (Apply to all)
        const basePatterns = [
            /about|company|who-we-are|profile|history/i,
            /team|leadership|management|executive|people/i,
            /contact/i
        ];

        // ICP-SPECIFIC PATTERNS
        if (lowerIcp.includes('family')) {
            // Family Office Focus
            priorityPatterns = [
                ...basePatterns,
                /family|history|legacy|philanthropy/i,
                /investments|direct|holdings|assets|portfolio/i,
                /strategy|philosophy|criteria/i
            ];
        } else if (lowerIcp.includes('fund') || lowerIcp.includes('private equity')) {
            // Fund Focus
            priorityPatterns = [
                ...basePatterns,
                /fund|strategy|criteria|thesis|approach/i,
                /portfolio|companies|investments|track-record/i
            ];
        } else {
            // Real Estate Developer / Operator Focus (Default)
            priorityPatterns = [
                ...basePatterns,
                /portfolio|projects|properties|assets|real-estate|developments|communities/i,
                /strategy|approach|investment|thesis|philosophy/i,
                /residential|multifamily|housing/i
            ];
        }

        let priority = links.filter(l => priorityPatterns.some(p => p.test(l)));

        // Remove junk (PDFs, Login, Legal)
        priority = priority.filter(l =>
            !/news|press|career|job|legal|privacy|login|signin|portal|events|media|report|download|\.pdf$/i.test(l)
        );

        // Deduplicate
        priority = [...new Set(priority)];

        // Limit to 40
        if (priority.length > 40) priority = priority.slice(0, 40);

        // Fallback: Just return homepage and a few others if none matched
        if (priority.length < 3) {
            // Return top 10 unique links that aren't obviously junk
            return links.filter(l => !/login|signin|privacy/i.test(l)).slice(0, 10);
        }

        return priority;
    },

    /**
     * Get breaker metrics
     */
    getMetrics() {
        return apifyBreaker.getState();
    }
};
