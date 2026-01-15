
import { LeadScraperService } from "./services/lead-scraper-service.js";
import { OutreachService } from "./services/outreach-service.js";
import { saveLeadsToDB } from "./workflow.js";
import { query } from "../../db/index.js";
import { CostTracker } from "./services/cost-tracker.js";

/**
 * Runs the enrichment workflow for a list of specific companies.
 * 
 * @param {Object} params
 * @param {string[]} params.companyIds - Array of company UUIDs to enrich
 * @param {string} params.icpId - The ICP ID context
 * @param {string} params.userId - The user ID
 * @param {Object} params.listeners - Event listeners (onLog, onProgress)
 */
export const runEnrichmentWorkflow = async ({ companyIds, icpId, userId, listeners }) => {
    const logStep = (step, detail) => {
        if (listeners?.onLog) listeners.onLog({ step, detail });
        else console.log(`[${step}] ${detail}`);
    };

    const costTracker = new CostTracker(`enrich_${Date.now()}`);
    const results = {
        companiesProcessed: 0,
        leadsFound: 0,
        messagesGenerated: 0,
        errors: []
    };

    try {
        logStep('System', `🚀 Starting enrichment for ${companyIds.length} companies...`);

        // 1. Fetch Company Details from DB
        const companyRes = await query(
            `SELECT company_name, website, company_profile 
             FROM companies 
             WHERE id = ANY($1::uuid[]) AND user_id = $2`,
            [companyIds, userId]
        );

        const companies = companyRes.rows.map(c => ({
            company_name: c.company_name,
            domain: c.website, // LeadScraper expects 'domain' or 'website'
            website: c.website,
            company_profile: c.company_profile
        }));

        if (companies.length === 0) {
            logStep('System', '❌ No valid companies found.');
            return results;
        }

        logStep('System', `📋 Loaded details for ${companies.length} companies.`);

        // 2. Run Lead Scraper (Apollo)
        const leadScraper = new LeadScraperService();
        // Use default filters or fetch from ICP? 
        // Ideally we should adhere to ICP filters if available.
        let filters = { idempotencyKey: `enrich_${Date.now()}` };

        if (icpId) {
            try {
                const icpRes = await query('SELECT config FROM icps WHERE id = $1', [icpId]);
                if (icpRes.rows.length > 0) {
                    const cfg = icpRes.rows[0].config;
                    if (cfg.job_titles) filters.job_titles = cfg.job_titles;
                    if (cfg.seniority) filters.seniority = cfg.seniority;
                    if (cfg.excluded_functions) filters.excluded_functions = cfg.excluded_functions;
                    if (cfg.geography) filters.geography = cfg.geography;
                    // Extract ICP Type/Name for Outreach reasoning
                    filters.icp_type_label = icpRes.rows[0].icp_type || 'General';
                }
            } catch (e) {
                console.warn("Failed to load ICP filters", e);
            }
        }

        logStep('Lead Finder', `🔍 Searching for leads...`);
        const scrapeResult = await leadScraper.fetchLeads(companies, filters, logStep, null);
        const leads = scrapeResult.leads || [];
        const disqualified = scrapeResult.disqualified || [];

        logStep('Lead Finder', `✅ Found ${leads.length} leads. (${disqualified.length} disqualified)`);

        if (leads.length === 0) {
            return results;
        }

        results.leadsFound = leads.length;

        // 3. Generate Outreach
        logStep('Outreach Creator', `Drafting messages for ${leads.length} leads...`);

        // We reuse the logic from workflow.js which calls OutreachService.createLeadMessages logic essentially, 
        // OR we can use the OutreachService directly if it exposes the right method.
        // Looking at previous analysis, OutreachService.createLeadMessages is static and uses hardcoded prompt mostly.

        // We need to attach company_profile to leads for the outreach generator to work best
        // The LeadScraper should have already attached it if we passed it in the companies array (it does normalization).
        // Let's ensure leads have company_profile.

        // 3. Generate Outreach - Iterating through leads one by one
        const enrichedLeads = [];
        const icpTypeLabel = filters.icp_type_label || 'General';

        // Limit concurrency if needed, but simple loop is safer for rate limits
        // UPDATE: Using chunks of 5 to speed up processing
        const BATCH_SIZE = 5;
        for (let i = 0; i < leads.length; i += BATCH_SIZE) {
            const batch = leads.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (lead) => {
                try {
                    // Ensure fit_score is passed (mapped from company_fit_score)
                    const outreachInput = {
                        ...lead,
                        fit_score: lead.company_fit_score,
                        icp_type: lead.icp_type || icpTypeLabel, // Use lead's type or fallback to ICP context
                        person_name: `${lead.first_name} ${lead.last_name}`
                    };

                    const enriched = await OutreachService.createLeadMessages(outreachInput);
                    return { ...lead, ...enriched };
                } catch (err) {
                    console.warn(`[Outreach] Failed for ${lead.email}:`, err.message);
                    return lead; // Keep lead even if message gen fails
                }
            });

            const results = await Promise.all(batchPromises);
            enrichedLeads.push(...results);

            // Optional small delay to be nice to rate limits
            if (i + BATCH_SIZE < leads.length) await new Promise(r => setTimeout(r, 200));
        }

        results.messagesGenerated = enrichedLeads.filter(l => (l.email_body && !l.email_body.includes('SKIPPED')) || (l.linkedin_message && !l.linkedin_message.includes('SKIPPED'))).length;
        logStep('Outreach Creator', `✅ Generated messages for ${results.messagesGenerated} leads.`);

        const leadsArray = enrichedLeads;

        // 4. Save to DB
        // We need to pass runId if we want to track it, but for now we might leave it null or generate one.
        // We'll reuse saveLeadsToDB.
        await saveLeadsToDB(leadsArray, userId, icpId, logStep, 'NEW');

        // Also save disqualified for review
        if (disqualified.length > 0) {
            await saveLeadsToDB(disqualified, userId, icpId, logStep, 'DISQUALIFIED');
        }

        results.companiesProcessed = companies.length;
        logStep('System', `🎉 Enrichment complete!`);

    } catch (error) {
        console.error("Enrichment failed", error);
        logStep('System', `❌ Error: ${error.message}`);
        results.errors.push(error.message);
    }

    return results;
};
