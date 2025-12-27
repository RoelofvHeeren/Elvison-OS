
// Workflow Configuration
// Toggle TESTING mode to enforce strict limits and save costs.

const IS_TESTING = process.env.WORKFLOW_MODE === 'testing' || true; // Default to TRUE for safety during dev/test

export const WORKFLOW_CONFIG = {
    // Mode
    IS_TESTING,

    // Limits
    MAX_LEADS_TESTING: 50,
    MAX_LEADS_PRODUCTION: 1000,

    // Batching (to avoid huge payloads)
    BATCH_SIZE_DOMAINS: 10,

    // Defaults
    DEFAULT_LEADS_PER_COMPANY: 3,
};

export const AGENT_MODELS = {
    company_finder: "gpt-4o-mini",
    company_profiler: "gpt-4o-mini", // Cost-saving trial. Revert to gpt-4o if quality suffers.
    apollo_lead_finder: "gpt-4o-mini",
    outreach_creator: "gpt-4o-mini",
    default: "gpt-4o-mini"
};

export const getEffectiveMaxLeads = () => {
    return IS_TESTING ? WORKFLOW_CONFIG.MAX_LEADS_TESTING : WORKFLOW_CONFIG.MAX_LEADS_PRODUCTION;
};
