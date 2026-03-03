/**
 * Pipeline: Generate Outreach
 * 
 * Wires the existing OutreachService V5 (fact extraction, gating, QA) into the pipeline.
 * Uses INDEX-BASED matching (not email-key) to guarantee outreach maps back to the correct lead.
 * 
 * Fixes Root Causes: #1 (email-key mismatch), #5 (dead outreach service)
 * 
 * Flow:
 *   Input:  leads[] with company_profile populated
 *   Output: leads[] with connection_request, email_message, outreach_status populated
 */

import { OutreachService } from '../services/outreach-service.js';
import { enrichLeadOutreach } from './persist.js';

/**
 * Generate outreach messages for a batch of leads using OutreachService V5.
 * 
 * Uses INDEX-BASED matching: processes leads in order, maps results back by index.
 * No email-key lookup = no mismatch = no data loss.
 * 
 * @param {Array} leads - Leads with company_profile, company_name, first_name, etc.
 * @param {Object} options 
 * @param {Function} options.logStep - Logger
 * @param {Function} options.checkCancellation - Async cancellation checker
 * @param {Object} options.companyContext - ICP context (outreachPromptInstructions, etc.)
 * @param {Object} options.costTracker - Cost tracking instance
 * @returns {Array} leads[] enriched with outreach data + outreach_status
 */
export async function generateOutreachForLeads(leads, options = {}) {
    const { logStep = console.log, checkCancellation, companyContext = {}, costTracker } = options;

    if (!leads || leads.length === 0) return [];

    // Reset metrics for this batch
    OutreachService.resetMetrics();

    logStep('Outreach Creator', `📝 Generating messages for ${leads.length} leads...`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Process each lead individually (index-based, deterministic)
    for (let i = 0; i < leads.length; i++) {
        if (checkCancellation && await checkCancellation()) {
            logStep('Outreach Creator', `⛔ Cancelled at lead ${i + 1}/${leads.length}`);
            // Mark remaining leads as needs_outreach
            for (let j = i; j < leads.length; j++) {
                results.push({
                    ...leads[j],
                    outreach_status: 'CANCELLED',
                    connection_request: null,
                    email_message: null
                });
            }
            break;
        }

        const lead = leads[i];

        try {
            // Extract entity type for gating (from classification or direct field)
            const icpType = lead.classification?.entity_type || lead.entity_type || 'UNKNOWN';

            const outreachResult = await OutreachService.createLeadMessages({
                company_name: lead.company_name,
                website: lead.company_website || lead.company_domain,
                company_profile: lead.company_profile || '',
                fit_score: lead.match_score || lead.company_fit_score,
                icp_type: icpType,
                first_name: lead.first_name,
                person_name: lead.person_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
                instructions: companyContext.outreachPromptInstructions || null,
                portfolio_deals: lead.portfolio_deals || [],
                investment_thesis: lead.investment_thesis || null
            });

            // INDEX-BASED MERGE: outreachResult maps to leads[i], no email lookup needed
            const enrichedLead = {
                ...lead,
                outreach_status: outreachResult.outreach_status,
                outreach_reason: outreachResult.outreach_reason,
                connection_request: outreachResult.linkedin_message || null,
                email_message: outreachResult.email_body || null,
                email_subject: outreachResult.email_subject || null,
                email_body: outreachResult.email_body || null,
                linkedin_message: outreachResult.linkedin_message || null,
                research_fact: outreachResult.research_fact,
                message_version: outreachResult.message_version
            };

            // Determine effective status
            if (outreachResult.outreach_status === 'SUCCESS') {
                enrichedLead.status = 'NEW';
                successCount++;
            } else if (outreachResult.outreach_status === 'NEEDS_RESEARCH') {
                enrichedLead.status = 'NEEDS_OUTREACH';
                failCount++;
            } else if (outreachResult.outreach_status === 'SKIP') {
                enrichedLead.status = 'NEEDS_OUTREACH';
                failCount++;
            } else {
                enrichedLead.status = 'NEEDS_OUTREACH';
                failCount++;
            }

            results.push(enrichedLead);

        } catch (e) {
            console.error(`[generate-outreach] Failed for ${lead.email}:`, e.message);
            // NEVER DROP: lead is preserved with failure status
            results.push({
                ...lead,
                outreach_status: 'ERROR',
                outreach_reason: e.message,
                status: 'NEEDS_OUTREACH',
                connection_request: null,
                email_message: null
            });
            failCount++;
        }
    }

    // Log summary
    const metrics = OutreachService.getMetrics();
    logStep('Outreach Creator', `✅ Done: ${successCount} success, ${failCount} need attention (${metrics.total_generated} total processed)`);

    if (metrics.skip_count > 0) {
        logStep('Outreach Creator', `⏭️ Skip reasons: ${JSON.stringify(metrics.skip_reasons)}`);
    }
    if (metrics.needs_research_count > 0) {
        logStep('Outreach Creator', `🔬 Needs research: ${JSON.stringify(metrics.needs_research_reasons)}`);
    }

    return results;
}

/**
 * Persist outreach results to DB for an already-saved batch of leads.
 * This is the "Enrich" step — UPDATE only, never INSERT.
 * 
 * @param {Array} enrichedLeads - Output from generateOutreachForLeads()
 * @param {Function} logStep - Logger
 * @returns {{ enriched: number, failed: number }}
 */
export async function persistOutreachResults(enrichedLeads, logStep = console.log) {
    if (!enrichedLeads || enrichedLeads.length === 0) return { enriched: 0, failed: 0 };

    let enriched = 0;
    let failed = 0;

    for (const lead of enrichedLeads) {
        // Only enrich leads that have outreach data
        if (lead.outreach_status !== 'SUCCESS') {
            // Still update status to NEEDS_OUTREACH so it's visible in CRM
            const result = await enrichLeadOutreach(lead.email, {}, lead.status || 'NEEDS_OUTREACH');
            if (result.success) enriched++;
            else failed++;
            continue;
        }

        const result = await enrichLeadOutreach(
            lead.email,
            {
                connection_request: lead.connection_request,
                email_message: lead.email_message,
                email_subject: lead.email_subject,
                email_body: lead.email_body,
                linkedin_message: lead.linkedin_message
            },
            'NEW'
        );

        if (result.success) {
            enriched++;
        } else {
            console.warn(`[generate-outreach] Failed to persist outreach for ${lead.email}: ${result.reason}`);
            failed++;
        }
    }

    logStep('Database', `📝 Outreach persistence: ${enriched} enriched, ${failed} failed`);
    return { enriched, failed };
}
