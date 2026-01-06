/**
 * Search Term Manager
 * Manages the rotating queue of search terms per ICP.
 * Ensures variety by tracking usage and rotating used terms to the back.
 */

import { query } from '../../../db/index.js';
import { runGeminiAgent } from './direct-agent-runner.js';

/**
 * Get search terms ordered by least recently used
 * Terms that have never been used come first, then oldest used first
 * 
 * @param {string} icpId - ICP UUID
 * @returns {Promise<Array<{term: string, last_used_at: string|null, uses: number}>>}
 */
export const getOrderedTerms = async (icpId) => {
    const result = await query(
        `SELECT search_terms FROM icps WHERE id = $1`,
        [icpId]
    );

    if (result.rows.length === 0) {
        return [];
    }

    let terms = result.rows[0].search_terms || [];

    // Parse if string
    if (typeof terms === 'string') {
        try {
            terms = JSON.parse(terms);
        } catch (e) {
            terms = [];
        }
    }

    // Sort by: never used first (null), then by oldest last_used_at
    return terms.sort((a, b) => {
        if (a.last_used_at === null && b.last_used_at === null) return 0;
        if (a.last_used_at === null) return -1;
        if (b.last_used_at === null) return 1;
        return new Date(a.last_used_at) - new Date(b.last_used_at);
    });
};

/**
 * Get just the term strings in order (for workflow consumption)
 * 
 * @param {string} icpId - ICP UUID
 * @returns {Promise<string[]>}
 */
export const getTermStrings = async (icpId) => {
    const terms = await getOrderedTerms(icpId);
    return terms.map(t => t.term);
};

/**
 * Mark search terms as used (updates last_used_at and increments uses counter)
 * This effectively rotates them to the back of the queue for next run
 * 
 * @param {string} icpId - ICP UUID
 * @param {string[]} termsUsed - Array of term strings that were used
 * @param {Object} resultsPerTerm - Optional: { term: resultCount }
 * @returns {Promise<void>}
 */
export const markTermsAsUsed = async (icpId, termsUsed, resultsPerTerm = {}) => {
    const existing = await getOrderedTerms(icpId);
    const now = new Date().toISOString();
    const usedSet = new Set(termsUsed);

    const updated = existing.map(item => {
        if (usedSet.has(item.term)) {
            return {
                ...item,
                last_used_at: now,
                uses: (item.uses || 0) + 1,
                last_results_count: resultsPerTerm[item.term] || 0
            };
        }
        return item;
    });

    await query(
        `UPDATE icps SET search_terms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updated), icpId]
    );

    console.log(`[SearchTermManager] Marked ${termsUsed.length} terms as used for ICP ${icpId}`);
};

/**
 * Add new search terms to the ICP
 * New terms are added with last_used_at = null so they get priority
 * 
 * @param {string} icpId - ICP UUID
 * @param {string[]} newTerms - Array of new term strings
 * @returns {Promise<void>}
 */
export const addSearchTerms = async (icpId, newTerms) => {
    const existing = await getOrderedTerms(icpId);
    const existingSet = new Set(existing.map(t => t.term.toLowerCase()));

    // Only add terms that don't already exist
    const toAdd = newTerms
        .filter(term => !existingSet.has(term.toLowerCase()))
        .map(term => ({
            term: term,
            last_used_at: null,
            uses: 0,
            last_results_count: 0
        }));

    if (toAdd.length === 0) {
        console.log('[SearchTermManager] No new unique terms to add');
        return;
    }

    const updated = [...existing, ...toAdd];

    await query(
        `UPDATE icps SET search_terms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updated), icpId]
    );

    console.log(`[SearchTermManager] Added ${toAdd.length} new terms to ICP ${icpId}`);
};

/**
 * Remove a search term from the ICP
 * 
 * @param {string} icpId - ICP UUID
 * @param {string} termToRemove - The term to remove
 * @returns {Promise<void>}
 */
export const removeSearchTerm = async (icpId, termToRemove) => {
    const existing = await getOrderedTerms(icpId);
    const updated = existing.filter(t => t.term.toLowerCase() !== termToRemove.toLowerCase());

    await query(
        `UPDATE icps SET search_terms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(updated), icpId]
    );

    console.log(`[SearchTermManager] Removed term "${termToRemove}" from ICP ${icpId}`);
};

/**
 * Reorder search terms (for manual drag-and-drop reordering in UI)
 * 
 * @param {string} icpId - ICP UUID
 * @param {string[]} orderedTerms - Array of term strings in the new order
 * @returns {Promise<void>}
 */
export const reorderSearchTerms = async (icpId, orderedTerms) => {
    const existing = await getOrderedTerms(icpId);
    const termMap = new Map(existing.map(t => [t.term, t]));

    // Rebuild array in the new order, preserving metadata
    const reordered = orderedTerms
        .map(term => termMap.get(term))
        .filter(Boolean);

    // Add any terms that weren't in the new order (shouldn't happen, but safety)
    const orderedSet = new Set(orderedTerms);
    existing.forEach(t => {
        if (!orderedSet.has(t.term)) {
            reordered.push(t);
        }
    });

    await query(
        `UPDATE icps SET search_terms = $1::jsonb, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(reordered), icpId]
    );

    console.log(`[SearchTermManager] Reordered terms for ICP ${icpId}`);
};

/**
 * Generate search terms using AI based on ICP description
 * 
 * @param {string} icpDescription - The ICP description
 * @param {number} count - Number of terms to generate (default 20)
 * @returns {Promise<string[]>}
 */
export const generateSearchTerms = async (icpDescription, count = 20) => {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[SearchTermManager] Missing GOOGLE_API_KEY for term generation');
        return [];
    }

    try {
        const response = await runGeminiAgent({
            apiKey,
            modelName: 'gemini-2.0-flash',
            agentName: 'Search Term Generator',
            instructions: `You are a search query optimization expert. Generate diverse, specific Google search queries that would help find companies matching the given ICP (Ideal Customer Profile).

RULES:
- Generate exactly ${count} unique search queries
- Make queries specific and varied (different angles, synonyms, geographic focuses)
- Include industry-specific terminology
- Mix broad and niche queries
- Do NOT repeat similar queries
- Each query should be 3-8 words

OUTPUT: Return ONLY a JSON object with a "terms" array:
{"terms": ["query 1", "query 2", ...]}`,
            userMessage: `Generate ${count} Google search queries to find companies matching this ICP:

"${icpDescription}"

Remember: Variety is key. Use different angles, synonyms, and geographic focuses.`,
            tools: [],
            maxTurns: 1
        });

        // Parse the response
        let terms = [];
        try {
            const cleanOutput = response.finalOutput
                .replace(/```json/gi, '')
                .replace(/```/g, '')
                .trim();

            const parsed = JSON.parse(cleanOutput);
            terms = parsed.terms || [];
        } catch (e) {
            console.warn('[SearchTermManager] Failed to parse AI response:', e.message);
        }

        console.log(`[SearchTermManager] Generated ${terms.length} search terms`);
        return terms;

    } catch (err) {
        console.error('[SearchTermManager] Term generation failed:', err.message);
        return [];
    }
};

/**
 * Initialize search terms for an ICP if empty
 * Uses AI to generate initial terms based on ICP config
 * 
 * @param {string} icpId - ICP UUID
 * @returns {Promise<void>}
 */
export const initializeSearchTermsIfEmpty = async (icpId) => {
    const existing = await getOrderedTerms(icpId);

    if (existing.length > 0) {
        console.log(`[SearchTermManager] ICP ${icpId} already has ${existing.length} search terms`);
        return;
    }

    // Get ICP description from config
    const result = await query(`SELECT config FROM icps WHERE id = $1`, [icpId]);
    if (result.rows.length === 0) return;

    const config = result.rows[0].config || {};
    const icpDescription = config.surveys?.company_finder?.icp_description ||
        config.icp_description ||
        config.description ||
        '';

    if (!icpDescription) {
        console.log('[SearchTermManager] No ICP description found, cannot auto-generate terms');
        return;
    }

    const terms = await generateSearchTerms(icpDescription, 20);
    if (terms.length > 0) {
        await addSearchTerms(icpId, terms);
    }
};

export default {
    getOrderedTerms,
    getTermStrings,
    markTermsAsUsed,
    addSearchTerms,
    removeSearchTerm,
    reorderSearchTerms,
    generateSearchTerms,
    initializeSearchTermsIfEmpty
};
