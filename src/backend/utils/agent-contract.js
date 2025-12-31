import { z } from "zod";

/**
 * Extract JSON from text - strips markdown fences
 * Duplicated here to ensure this module is self-contained for contract enforcement
 */
function extractJson(text) {
    if (!text) return text;
    // Handle objects/arrays directly
    if (typeof text !== 'string') return JSON.stringify(text);

    return text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
}

/**
 * Normalize Filter Refiner Output
 * Ensures: job_titles, industries, geographies are arrays
 */
function normalizeFilterRefiner(output) {
    const safeOutput = output || {};
    return {
        job_titles: Array.isArray(safeOutput.job_titles) ? safeOutput.job_titles : [],
        industries: Array.isArray(safeOutput.industries) ? safeOutput.industries : [],
        geographies: Array.isArray(safeOutput.geographies) ? safeOutput.geographies : [],
        seniority: Array.isArray(safeOutput.seniority) ? safeOutput.seniority : [],
        excluded_keywords: Array.isArray(safeOutput.excluded_keywords) ? safeOutput.excluded_keywords : []
    };
}

/**
 * Normalize Company Finder Output
 * Ensures: results is an array
 */
function normalizeCompanyFinder(output) {
    const safeOutput = output || {};
    return {
        results: Array.isArray(safeOutput.results) ? safeOutput.results : []
    };
}

/**
 * Normalize Outreach Creator Output
 * Ensures: leads is an array. Handles root-level array vs object wrapper.
 */
function normalizeOutreachCreator(output) {
    if (Array.isArray(output)) {
        return { leads: output };
    }
    const safeOutput = output || {};
    return {
        leads: Array.isArray(safeOutput.leads) ? safeOutput.leads : []
    };
}

/**
 * Central Normalization Router
 */
function normalizeByAgent(agentName, output) {
    switch (agentName) {
        case "Filter Refiner":
            return normalizeFilterRefiner(output);
        case "Company Finder":
            return normalizeCompanyFinder(output);
        case "Outreach Creator":
            return normalizeOutreachCreator(output);
        default:
            return output || {};
    }
}

/**
 * HARD GATEKEEPER: Enforces Agent Contract
 * 1. Parse JSON (fail fast)
 * 2. Normalize (MANDATORY)
 * 3. Validate (ONLY normalized output)
 */
export function enforceAgentContract({ agentName, rawOutput, schema }) {
    // 1. Parse JSON (fail fast if impossible)
    let parsed;
    try {
        if (typeof rawOutput === 'object' && rawOutput !== null) {
            parsed = rawOutput;
        } else {
            const cleaned = extractJson(rawOutput);
            parsed = JSON.parse(cleaned);
        }
    } catch (e) {
        throw new Error(`[${agentName}] Model did not return valid JSON: ${rawOutput?.substring(0, 100)}...`);
    }

    // 2. Normalize BEFORE validation (MANDATORY)
    const normalized = normalizeByAgent(agentName, parsed);

    console.log(`[${agentName}] Normalized output before validation:`, JSON.stringify(normalized, null, 2));

    // 3. Validate ONLY normalized output
    if (schema) {
        const result = schema.safeParse(normalized);
        if (!result.success) {
            throw new Error(
                `[${agentName}] Normalized output failed schema validation:\n` +
                JSON.stringify(result.error.format(), null, 2) +
                `\nData: ${JSON.stringify(normalized, null, 2)}`
            );
        }
        return normalized; // Return the normalized data if schema passes
    }

    return normalized;
}
