/**
 * Pipeline: Orchestrator
 * 
 * Replaces the monolithic `processQualifiedCompanies` function in workflow.js.
 * Chains: Scrape → Normalize → Rank → Outreach → Save
 * 
 * Each stage is independent, testable, and observable.
 * Uses "Save-Then-Enrich" pattern: leads are saved to DB BEFORE outreach is generated.
 */

import { saveLeadsBatch } from './persist.js';
import { generateOutreachForLeads, persistOutreachResults } from './generate-outreach.js';
import { runGeminiAgent } from '../services/direct-agent-runner.js';
import { enforceAgentContract } from '../utils/agent-contract.js';
import { z } from 'zod';

/**
 * Process a batch of qualified companies through the full pipeline.
 * 
 * Pipeline:
 *   1. [SCRAPE]    Find decision-makers at each company (Apify)
 *   2. [NORMALIZE] Clean & validate lead data (Data Architect LLM)
 *   3. [RANK]      Score lead-ICP fit (Lead Ranker LLM)
 *   4. [SAVE]      Persist leads to DB with status = 'SCRAPED'  ← SAVE FIRST
 *   5. [OUTREACH]  Generate personalized messages (OutreachService V5)
 *   6. [ENRICH]    UPDATE leads with outreach data   ← THEN ENRICH
 * 
 * @param {Array} companies - Qualified company objects from profiling
 * @param {Object} ctx - Pipeline context
 * @returns {Array} Final enriched leads
 */
export async function processCompanyBatch(companies, ctx) {
    const {
        leadScraper,
        filters,
        idempotencyKey,
        googleKey,
        userId,
        icpId,
        runId,
        logStep,
        checkCancellation,
        costTracker,
        companyContext,
        maxLeadsPerCompany = 3
    } = ctx;

    if (!companies || companies.length === 0) return [];

    // --- Stage 1: SCRAPE ---
    logStep('Lead Finder', `🚀 Scraping leads for ${companies.length} companies...`);
    let rawLeads = [];

    try {
        if (checkCancellation && await checkCancellation()) return [];

        const scrapeFilters = {
            ...filters,
            idempotencyKey: idempotencyKey || `wf_${Date.now()}_batch`
            // NOTE: Removed onBatchComplete callback — we save leads ourselves after outreach
        };

        const scrapeResult = await leadScraper.fetchLeads(companies, scrapeFilters, logStep, checkCancellation);
        rawLeads = scrapeResult.leads || (Array.isArray(scrapeResult) ? scrapeResult : []);
        const disqualified = scrapeResult.disqualified || [];

        logStep('Lead Finder', `Found ${rawLeads.length} leads (${disqualified.length} disqualified)`);

        // Save disqualified leads immediately (they don't need outreach)
        if (disqualified.length > 0) {
            await saveLeadsBatch(disqualified, userId, icpId, logStep, 'DISQUALIFIED', runId);
        }

    } catch (e) {
        logStep('Lead Finder', `⚠️ Scraping failed: ${e.message}`);
        return [];
    }

    if (rawLeads.length === 0) return [];

    // --- Stage 2: NORMALIZE ---
    logStep('Data Architect', `📋 Normalizing ${rawLeads.length} leads...`);
    let normalizedLeads = await normalizeBatch(rawLeads, googleKey, logStep, costTracker);

    if (normalizedLeads.length === 0) return [];

    // --- Stage 3: RANK ---
    logStep('Lead Ranker', `🏆 Ranking ${normalizedLeads.length} leads...`);
    let rankedLeads = await rankBatch(normalizedLeads, googleKey, logStep, costTracker, companyContext);

    // Apply maxLeadsPerCompany cap
    const perCompany = {};
    rankedLeads.forEach(l => {
        const key = l.company_name || 'unknown';
        if (!perCompany[key]) perCompany[key] = [];
        if (perCompany[key].length < maxLeadsPerCompany) perCompany[key].push(l);
    });
    const cappedLeads = Object.values(perCompany).flat();

    // --- Stage 4: SAVE (before outreach!) ---
    logStep('Database', `💾 Saving ${cappedLeads.length} leads (before outreach)...`);
    const saveResult = await saveLeadsBatch(cappedLeads, userId, icpId, logStep, 'SCRAPED', runId);

    // --- Stage 5: OUTREACH ---
    if (checkCancellation && await checkCancellation()) return cappedLeads;

    const enrichedLeads = await generateOutreachForLeads(cappedLeads, {
        logStep,
        checkCancellation,
        companyContext,
        costTracker
    });

    // --- Stage 6: ENRICH (update DB with outreach data) ---
    await persistOutreachResults(enrichedLeads, logStep);

    return enrichedLeads;
}


// === Internal Helpers ===

/**
 * Normalize leads using Data Architect LLM.
 * Separates "clean" leads (have name + email) from "ambiguous" ones.
 */
async function normalizeBatch(leads, googleKey, logStep, costTracker) {
    const clean = leads.filter(l => l.first_name && l.last_name && l.email);
    const ambiguous = leads.filter(l => !l.first_name || !l.last_name || !l.email);

    if (ambiguous.length === 0) return clean;

    // Backup full objects before sending lightweight versions to LLM
    const backup = new Map();
    const lightweight = ambiguous.map(l => {
        const key = l.email || l.linkedin_url || `${l.first_name}_${l.company_name}`;
        backup.set(key, { ...l });
        const { company_profile, ...rest } = l;
        return rest;
    });

    let fixed = [];
    try {
        const res = await runGeminiAgent({
            apiKey: googleKey,
            modelName: 'gemini-2.0-flash',
            agentName: 'Data Architect',
            instructions: `You are a data normalization agent. Fix capitalization, validate emails, mark is_valid: true/false. Return JSON { "leads": [...] }`,
            userMessage: `Normalize these leads: ${JSON.stringify(lightweight)}`,
            tools: [],
            maxTurns: 2,
            logStep
        });

        if (!res.finalOutput) {
            logStep('Data Architect', `⚠️ LLM returned null, using raw data`);
            return [...clean, ...ambiguous.filter(l => l.email)];
        }

        const parsed = enforceAgentContract({
            agentName: 'Data Architect',
            rawOutput: res.finalOutput,
            schema: z.object({ leads: z.array(z.any()) })
        });

        fixed = (parsed.leads || []).filter(l => l.is_valid).map(l => {
            const key = l.email || l.linkedin_url || `${l.first_name}_${l.company_name}`;
            const original = backup.get(key) || {};
            return { ...original, ...l }; // Merge: LLM fixes over original (preserves company_profile)
        });

        if (costTracker) {
            costTracker.recordCall({
                agent: 'Data Architect', model: 'gemini-2.0-flash',
                inputTokens: res.usage?.inputTokens || 0,
                outputTokens: res.usage?.outputTokens || 0,
                duration: 0, success: true
            });
        }

    } catch (e) {
        logStep('Data Architect', `⚠️ Normalization failed: ${e.message}. Using best-effort.`);
        fixed = ambiguous.filter(l => l.email);
    }

    const result = [...clean, ...fixed];
    logStep('Data Architect', `✅ ${result.length} leads normalized (${clean.length} clean + ${fixed.length} fixed)`);
    return result;
}

/**
 * Rank leads using Lead Ranker LLM.
 */
async function rankBatch(leads, googleKey, logStep, costTracker, companyContext) {
    try {
        const res = await runGeminiAgent({
            apiKey: googleKey,
            modelName: 'gemini-2.0-flash',
            agentName: 'Lead Ranker',
            instructions: `
            Rank leads 1-10 based on seniority and decision-making power for the user's goal: ${companyContext?.goal || 'Expand residential real estate partnerships'}.
            
            **SCORING RULES (STRICT):**
            - **9-10 (High Priority)**: C-Level (CEO, CIO), Owner, Founder, Partner, Principal, Managing Director.
            - **7-8 (Priority)**: VP, Senior Director, Head of [Real Estate/Acquisitions/Investments].
            - **5-6 (Secondary)**: Director, Associate Director.
            - **1-4 (REJECT/LOW)**: Analyst, Associate, Assistant, HR, Marketing, Operations, Entry-level.
            
            **PENALIZE EXTREMELY LOW**: "Intern", "Student", "Support", "Admin".
            
            Target Titles: ${(companyContext?.baselineTitles || []).join(', ')}.
            Return JSON { "leads": [{ "email": "...", "match_score": 8 }] }.`,
            userMessage: `Rank: ${JSON.stringify(leads.slice(0, 50).map(l => ({ email: l.email, title: l.title, company: l.company_name })))}`,
            tools: [],
            maxTurns: 2,
            logStep
        });

        if (!res.finalOutput) {
            logStep('Lead Ranker', `⚠️ LLM returned null, keeping default scores`);
            return leads;
        }

        const parsed = enforceAgentContract({
            agentName: 'Lead Ranker',
            rawOutput: res.finalOutput,
            schema: z.object({
                leads: z.array(z.object({
                    email: z.string(),
                    match_score: z.number()
                }))
            })
        });

        const scoreMap = new Map((parsed.leads || []).map(l => [l.email, l.match_score]));
        const ranked = leads.map(l => ({
            ...l,
            match_score: scoreMap.get(l.email) || 5
        })).sort((a, b) => (b.match_score || 0) - (a.match_score || 0));

        if (costTracker) {
            costTracker.recordCall({
                agent: 'Lead Ranker', model: 'gemini-2.0-flash',
                inputTokens: res.usage?.inputTokens || 0,
                outputTokens: res.usage?.outputTokens || 0,
                duration: 0, success: true
            });
        }

        logStep('Lead Ranker', `✅ Ranked ${ranked.length} leads`);
        return ranked;

    } catch (e) {
        logStep('Lead Ranker', `⚠️ Ranking failed: ${e.message}. Using default scores.`);
        return leads;
    }
}
