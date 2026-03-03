/**
 * Pipeline: Persist
 * 
 * COALESCE-based DB persistence. Never overwrites existing outreach data with NULL.
 * Implements "Save-Then-Enrich" pattern:
 *   1. saveLead()      — INSERT or UPDATE, never drops leads
 *   2. enrichOutreach() — UPDATE only outreach fields (never touches lead data)
 * 
 * Fixes Root Causes: #2 (silent UPSERT overwrites), #3 (premature saves), #7 (CRM gate drops)
 */

import { query } from '../../../db/index.js';

// Lightweight gate: only drops truly unusable data (no email)
// Never blocks leads for missing outreach — that's a separate enrichment step
const isMinimumViable = (lead) => {
    if (!lead.email) return { pass: false, reason: 'Missing email' };

    const emailDomain = lead.email.split('@')[1]?.toLowerCase();
    const BLOCKED_DOMAINS = [
        'linktr.ee', 'linktree.com', 'example.com', 'test.com',
        'temp-mail.org', 'mailinator.com', 'guerrillamail.com',
        'bio.link', 'beacons.ai', 'stan.store', 'carrd.co'
    ];
    if (!emailDomain || BLOCKED_DOMAINS.includes(emailDomain)) {
        return { pass: false, reason: `Blocked email domain: ${emailDomain || 'missing'}` };
    }

    return { pass: true };
};

/**
 * Save a single lead to the database.
 * Uses COALESCE on all enrichment fields so we NEVER overwrite existing data with null.
 * 
 * @param {Object} lead - The lead object
 * @param {string} userId - User UUID
 * @param {string|null} icpId - ICP UUID
 * @param {string} status - Lead status (SCRAPED, NEW, MANUAL_REVIEW, DISQUALIFIED)
 * @param {string|null} runId - Workflow run UUID
 * @returns {{ id: string, action: 'inserted'|'updated'|'rejected', reason?: string }}
 */
export async function saveLead(lead, userId, icpId, status, runId) {
    const gate = isMinimumViable(lead);
    if (!gate.pass) {
        return { id: null, action: 'rejected', reason: gate.reason };
    }

    try {
        const result = await query(`
            INSERT INTO leads (
                company_name, person_name, email, job_title, linkedin_url,
                status, source, user_id, icp_id, custom_data, run_id,
                company_website, company_domain, match_score,
                email_message, email_body, email_subject,
                linkedin_message, connection_request,
                disqualification_reason, company_profile
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, 'Outbound Agent', $7, $8, $9, $10,
                $11, $12, $13,
                $14, $15, $16,
                $17, $18,
                $19, $20
            )
            ON CONFLICT (email) DO UPDATE SET
                company_name     = COALESCE(EXCLUDED.company_name,     leads.company_name),
                person_name      = COALESCE(EXCLUDED.person_name,      leads.person_name),
                job_title        = COALESCE(EXCLUDED.job_title,        leads.job_title),
                linkedin_url     = COALESCE(EXCLUDED.linkedin_url,     leads.linkedin_url),
                icp_id           = COALESCE(EXCLUDED.icp_id,           leads.icp_id),
                run_id           = COALESCE(EXCLUDED.run_id,           leads.run_id),
                company_website  = COALESCE(EXCLUDED.company_website,  leads.company_website),
                company_domain   = COALESCE(EXCLUDED.company_domain,   leads.company_domain),
                company_profile  = COALESCE(EXCLUDED.company_profile,  leads.company_profile),
                match_score      = COALESCE(EXCLUDED.match_score,      leads.match_score),
                custom_data      = COALESCE(EXCLUDED.custom_data,      leads.custom_data),
                -- CRITICAL: Outreach fields use COALESCE — never overwrite with null
                email_message       = COALESCE(EXCLUDED.email_message,       leads.email_message),
                email_body          = COALESCE(EXCLUDED.email_body,          leads.email_body),
                email_subject       = COALESCE(EXCLUDED.email_subject,       leads.email_subject),
                linkedin_message    = COALESCE(EXCLUDED.linkedin_message,    leads.linkedin_message),
                connection_request  = COALESCE(EXCLUDED.connection_request,  leads.connection_request),
                -- Status: only upgrade, never downgrade
                status = CASE
                    WHEN EXCLUDED.status = 'NEW' AND (EXCLUDED.connection_request IS NOT NULL OR EXCLUDED.email_message IS NOT NULL)
                        THEN 'NEW'
                    WHEN EXCLUDED.status = 'DISQUALIFIED'
                        THEN 'DISQUALIFIED'
                    ELSE COALESCE(leads.status, EXCLUDED.status)
                END,
                disqualification_reason = COALESCE(EXCLUDED.disqualification_reason, leads.disqualification_reason),
                updated_at = NOW()
            RETURNING id, (xmax = 0) AS was_inserted
        `, [
            lead.company_name,
            `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.person_name,
            lead.email,
            lead.title || lead.job_title,
            lead.linkedin_url,
            status,
            userId,
            icpId || null,
            lead.custom_data || {
                icp_id: icpId,
                score: lead.match_score,
                company_profile: lead.company_profile,
                company_website: lead.company_website || lead.company_domain,
                company_domain: lead.company_domain
            },
            runId || null,
            lead.company_website || lead.company_domain,
            lead.company_domain,
            lead.match_score,
            lead.email_message || null,
            lead.email_body || null,
            lead.email_subject || null,
            lead.linkedin_message || null,
            lead.connection_request || null,
            lead.disqualification_reason || null,
            lead.company_profile || null
        ]);

        const row = result.rows[0];
        const action = row.was_inserted ? 'inserted' : 'updated';

        // Link lead to user
        await query(
            `INSERT INTO leads_link(lead_id, parent_id, parent_type) 
             VALUES($1, $2, 'user') 
             ON CONFLICT DO NOTHING`,
            [row.id, userId]
        );

        return { id: row.id, action };

    } catch (e) {
        console.error(`[persist] Failed to save lead ${lead.email}:`, e.message);
        return { id: null, action: 'rejected', reason: e.message };
    }
}

/**
 * Save a batch of leads. Returns summary stats.
 * 
 * @param {Array} leads 
 * @param {string} userId 
 * @param {string|null} icpId 
 * @param {Function} logStep - Logger function(step, detail)
 * @param {string} status 
 * @param {string|null} runId 
 * @returns {{ saved: number, updated: number, rejected: number }}
 */
export async function saveLeadsBatch(leads, userId, icpId, logStep, status = 'SCRAPED', runId = null) {
    if (!leads || leads.length === 0) return { saved: 0, updated: 0, rejected: 0 };

    let saved = 0, updated = 0, rejected = 0;
    const savedIds = [];

    for (const lead of leads) {
        const result = await saveLead(lead, userId, icpId, status, runId);
        if (result.action === 'inserted') { saved++; savedIds.push(result.id); }
        else if (result.action === 'updated') { updated++; savedIds.push(result.id); }
        else { rejected++; }
    }

    if (saved > 0 || updated > 0) {
        logStep('Database', `💾 Persisted ${saved} new + ${updated} updated leads (${rejected} rejected)`);
    }

    // Sync companies to display table
    if (saved > 0 || updated > 0) {
        await syncCompanies(leads.filter(l => l.email), userId, icpId);
    }

    return { saved, updated, rejected, ids: savedIds };
}

/**
 * UPDATE only outreach fields for an existing lead.
 * This is the "Enrich" half of "Save-Then-Enrich".
 * NEVER touches lead metadata — only outreach columns.
 * 
 * @param {string} leadEmail - Email to look up
 * @param {Object} outreach - { connection_request, email_message, email_subject, email_body, linkedin_message }
 * @param {string} newStatus - Usually 'NEW' if outreach succeeded
 * @returns {{ success: boolean, reason?: string }}
 */
export async function enrichLeadOutreach(leadEmail, outreach, newStatus = 'NEW') {
    if (!leadEmail) return { success: false, reason: 'No email' };
    if (!outreach) return { success: false, reason: 'No outreach data' };

    // Must have at least one message
    const hasMessage = outreach.connection_request || outreach.email_message ||
        outreach.email_body || outreach.linkedin_message;
    if (!hasMessage) {
        return { success: false, reason: 'Outreach object has no messages' };
    }

    try {
        const result = await query(`
            UPDATE leads SET
                connection_request = COALESCE($2, connection_request),
                email_message      = COALESCE($3, email_message),
                email_subject      = COALESCE($4, email_subject),
                email_body         = COALESCE($5, email_body),
                linkedin_message   = COALESCE($6, linkedin_message),
                status             = $7,
                updated_at         = NOW()
            WHERE email = $1
            RETURNING id
        `, [
            leadEmail,
            outreach.connection_request || null,
            outreach.email_message || null,
            outreach.email_subject || null,
            outreach.email_body || null,
            outreach.linkedin_message || null,
            newStatus
        ]);

        if (result.rows.length === 0) {
            return { success: false, reason: 'Lead not found in DB' };
        }

        console.log(`[persist] ✅ Enriched outreach for ${leadEmail} (status → ${newStatus})`);
        return { success: true, leadId: result.rows[0].id };

    } catch (e) {
        console.error(`[persist] Failed to enrich ${leadEmail}:`, e.message);
        return { success: false, reason: e.message };
    }
}

/**
 * Sync companies from leads to companies display table.
 * Internal helper — deduplicates by company_name.
 */
async function syncCompanies(leads, userId, icpId) {
    try {
        const { markCompaniesAsResearched } = await import('../company-tracker.js');

        const uniqueCompanies = [...new Set(leads.map(l => l.company_name).filter(Boolean))];

        for (const name of uniqueCompanies) {
            const lead = leads.find(l => l.company_name === name);
            const website = lead.company_website || lead.company_domain || lead.domain;
            let score = parseInt(lead.company_fit_score || lead.match_score);
            if (isNaN(score)) score = null;

            await query(`
                INSERT INTO companies (user_id, company_name, website, company_profile, fit_score, created_at, last_updated)
                VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                ON CONFLICT (user_id, company_name) 
                DO UPDATE SET
                    website = COALESCE(EXCLUDED.website, companies.website),
                    company_profile = COALESCE(EXCLUDED.company_profile, companies.company_profile),
                    fit_score = COALESCE(EXCLUDED.fit_score, companies.fit_score),
                    last_updated = NOW()
            `, [userId, name, website, lead.company_profile, score]);
        }

        // Mark as researched for exclusion in future runs
        const companiesToMark = uniqueCompanies.map(name => {
            const lead = leads.find(l => l.company_name === name);
            return {
                name,
                domain: lead.company_website || lead.company_domain || lead.domain,
                leadCount: leads.filter(l => l.company_name === name).length,
                metadata: { source: 'pipeline_persist', icp_id: icpId }
            };
        });
        await markCompaniesAsResearched(userId, companiesToMark);

    } catch (e) {
        console.error('[persist] Company sync failed:', e.message);
    }
}
