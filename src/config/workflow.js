
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

// MODEL CONFIGURATION
// All agents use Gemini 2.0 Flash (cheapest: $0.10/$0.40 per 1M tokens)
// Except Company Profiler which uses Claude 3.5 Sonnet (best research: $3.00/$15.00 per 1M tokens)
export const AGENT_MODELS = {
    company_finder: "gemini-2.0-flash",      // Discovery - cheap and fast
    company_profiler: "claude-3-5-sonnet",   // Research - needs good reasoning
    apollo_lead_finder: "gemini-2.0-flash",  // Structured queries - simple task
    outreach_creator: "gemini-2.0-flash",    // Copy generation - scales cheaply
    data_architect: "gemini-2.0-flash",      // Data normalization - simple task
    // filter_refiner: REMOVED - redundant, user sets filters in onboarding
    default: "gemini-2.0-flash"
};

export const getEffectiveMaxLeads = () => {
    return IS_TESTING ? WORKFLOW_CONFIG.MAX_LEADS_TESTING : WORKFLOW_CONFIG.MAX_LEADS_PRODUCTION;
};
