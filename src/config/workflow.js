
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
    company_finder: "gemini-1.5-flash",    // Cheap, fast, great extraction
    company_profiler: "claude-3-5-sonnet",  // Best research brain per dollar
    apollo_lead_finder: "gpt-4-turbo",      // Reliable structured query generation
    outreach_creator: "gemini-1.5-flash",   // Scales copy cheaply
    data_architect: "claude-3-5-sonnet",    // Fallback for validaton
    default: "gemini-1.5-flash"
};

export const getEffectiveMaxLeads = () => {
    return IS_TESTING ? WORKFLOW_CONFIG.MAX_LEADS_TESTING : WORKFLOW_CONFIG.MAX_LEADS_PRODUCTION;
};
