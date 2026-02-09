import { scanSiteStructure, scrapeSpecificPages, scrapeCompanyWebsite } from './apify.js';
import { query } from '../../../db/index.js';
import { CircuitBreaker } from '../../utils/circuit-breaker.js';
import LLMFunnelProfiler from './llm-funnel-profiler.js';

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
            try {
                // 1. Scan Structure (Local First)
                const scanResult = await scanSiteStructure(domain, APIFY_TOKEN);
                const discoveredLinks = scanResult?.links || [];

                if (discoveredLinks.length === 0) {
                    return { status: 'failed', reason: 'No links discovered during scan' };
                }

                // --- STAGE 1: IDENTITY QUALIFICATION ---
                console.log(`[Profiler] Stage 1: Selecting identity pages for verification...`);
                const identityUrls = await LLMFunnelProfiler.filterIdentityPages(discoveredLinks, companyName, icpType);

                if (identityUrls.length === 0) {
                    return { status: 'failed', reason: 'Could not identify core About/Strategy pages' };
                }

                console.log(`[Profiler] Stage 1: Scraping identity pages (${identityUrls.length})...`);
                const identityContent = await scrapeSpecificPages(identityUrls, APIFY_TOKEN);

                console.log(`[Profiler] Stage 1: Reasoning on qualification...`);
                const qualification = await LLMFunnelProfiler.qualifyCompany(identityContent, companyName, icpType);

                if (!qualification.is_qualified) {
                    console.log(`[Profiler] ❌ DISQUALIFIED: ${qualification.reason}`);

                    // Mark as disqualified in DB
                    await query(
                        `UPDATE leads 
                         SET status = 'DISQUALIFIED', 
                             custom_data = COALESCE(custom_data, '{}'::jsonb) || $1::jsonb,
                             updated_at = NOW()
                         WHERE company_name ILIKE $2 OR custom_data::text LIKE $3`,
                        [
                            JSON.stringify({
                                qualification_reason: qualification.reason,
                                entity_type: qualification.entity_type,
                                qualification_confidence: qualification.confidence,
                                disqualified_at: new Date().toISOString()
                            }),
                            `%${companyName}%`,
                            `%${domain}%`
                        ]
                    );

                    return { status: 'disqualified', reason: qualification.reason };
                }

                console.log(`[Profiler] ✅ QUALIFIED (${qualification.entity_type}): Proceeding to Deep Audit...`);

                // --- STAGE 2: DEEP AUDIT ---
                // Select Relevant Pages for Portfolio/Deals
                let targetUrls = await LLMFunnelProfiler.filterRelevantPages(discoveredLinks, companyName, icpType);

                // DEEP DISCOVERY: If we have Hubs (Real Estate, Portfolio), scrape them for DEEP LINKS
                const hubs = discoveredLinks.filter(l =>
                    /real-estate|portfolio|asset-management|projects|investments/i.test(l) &&
                    !l.includes('login') && !l.includes('contact')
                ).slice(0, 5);

                if (hubs.length > 0) {
                    console.log(`[Profiler] Deep Discovery: Scanning ${hubs.length} hubs for specific project/deal links...`);
                    const hubContent = await scrapeSpecificPages(hubs, APIFY_TOKEN);

                    // Extract all internal absolute links from hub content
                    const domainPattern = domain.replace(/^www\./, '').replace('.', '\\.');
                    const deepLinkRegex = new RegExp(`https?://[^\\s)"]*${domainPattern}[^\\s)"]*`, 'gi');
                    const deepLinks = [...new Set(hubContent.match(deepLinkRegex) || [])];

                    if (deepLinks.length > 0) {
                        console.log(`[Profiler] Found ${deepLinks.length} deep links. Aggregating for final selection...`);
                        const updatedLinks = [...new Set([...discoveredLinks, ...deepLinks])];
                        targetUrls = await LLMFunnelProfiler.filterRelevantPages(updatedLinks, companyName, icpType);
                    }
                }

                // If still empty, use Search Discovery as fallback
                if (targetUrls.length === 0) {
                    console.warn(`[Profiler] Recursive discovery yielding no pages. Trying Search Discovery...`);
                    targetUrls = await LLMFunnelProfiler.discoverPagesViaSearch(domain, companyName);
                }

                // Final Scrape
                let content = "";
                if (targetUrls.length > 0) {
                    console.log(`[Profiler] Scraping ${targetUrls.length} prioritized pages (Deep Audit)...`);
                    const prioritizedUrls = [...new Set(targetUrls)].sort((a, b) => {
                        const priorityKeywords = ['multifamily', 'residential', 'housing', 'apartments', 'living', 'portfolio', 'real-estate', 'projects', 'deals', 'strategy', 'criteria', 'investments', 'properties'];
                        const aLower = a.toLowerCase();
                        const bLower = b.toLowerCase();
                        const aScore = priorityKeywords.some(k => aLower.includes(k)) ? 0 : 1;
                        const bScore = priorityKeywords.some(k => bLower.includes(k)) ? 0 : 1;
                        return aScore - bScore;
                    });
                    content = await scrapeSpecificPages(prioritizedUrls, APIFY_TOKEN);
                } else {
                    console.warn(`[Profiler] No targeted deep URLs found. Falling back to homepage crawl...`);
                    content = await scrapeCompanyWebsite(domain, APIFY_TOKEN);
                }

                // 4. Extract Facts & Generate Profile (LLM Funnel - Stage 2)
                console.log(`[Profiler] Extracting facts and generating profile...`);
                const [outreachFacts, generatedProfile] = await Promise.all([
                    LLMFunnelProfiler.extractOutreachFacts(content, companyName, icpType),
                    LLMFunnelProfiler.generateCompanyProfile(content, companyName, icpType)
                ]);

                // 5. Update Database
                const finalProfile = generatedProfile || content.slice(0, 5000);

                await query(
                    `UPDATE leads 
                     SET company_profile = $1, 
                         investment_thesis = $2,
                         custom_data = jsonb_set(
                             jsonb_set(
                                 jsonb_set(
                                     COALESCE(custom_data, '{}'::jsonb),
                                     '{portfolio_deals}',
                                     $3::jsonb
                                 ),
                                 '{managed_funds}',
                                 $4::jsonb
                             ),
                             '{recent_news}',
                             $5::jsonb
                         ),
                         updated_at = NOW(),
                         outreach_status = 'NEEDS_RESEARCH',
                         outreach_reason = 'profile_enriched_pending_regen'
                     WHERE company_name ILIKE $6 OR custom_data::text LIKE $7`,
                    [
                        finalProfile,
                        outreachFacts?.investment_thesis || null,
                        JSON.stringify(outreachFacts?.portfolio_deals || []),
                        JSON.stringify(outreachFacts?.managed_funds || []),
                        JSON.stringify(outreachFacts?.recent_news || []),
                        `%${companyName}%`,
                        `%${domain}%`
                    ]
                );

                console.log(`[Profiler] Successfully enriched ${companyName}`);

                return {
                    status: 'success',
                    data: {
                        company_profile: finalProfile,
                        custom_data: {
                            investment_thesis: outreachFacts?.investment_thesis || "",
                            portfolio_deals: outreachFacts?.portfolio_deals || [],
                            managed_funds: outreachFacts?.managed_funds || [],
                            recent_news: outreachFacts?.recent_news || []
                        }
                    }
                };
            } catch (e) {
                // Re-throw critical system errors to trip breaker
                if (e.message.includes('timeout') || e.message.includes('ECONNREFUSED') || e.code >= 500) {
                    throw e;
                }
                // Determine if it's a content error or unknown error
                console.error(`[Profiler] Non-critical error for ${domain}: ${e.message}`);
                return { status: 'failed', reason: e.message };
            }
        });
    },

    /**
     * Get breaker metrics
     */
    getMetrics() {
        return apifyBreaker.getState();
    }
};
