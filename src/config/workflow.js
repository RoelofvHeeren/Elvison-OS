
// Workflow Configuration

// Testing mode disabled - use production limits
const IS_TESTING = false;

export const WORKFLOW_CONFIG = {
    // Mode
    IS_TESTING,

    // Limits
    MAX_LEADS_TESTING: 10,
    MAX_LEADS_PRODUCTION: 1000,

    // Batching (to avoid huge payloads)
    BATCH_SIZE_DOMAINS: 10,

    // Defaults
    DEFAULT_LEADS_PER_COMPANY: 3,
};

// MODEL CONFIGURATION
// All agents use Gemini 2.0 Flash for now (cheapest: $0.10/$0.40 per 1M tokens)
// NOTE: Claude Sonnet is better for research but @openai/agents Runner doesn't support it properly
// TODO: Build direct Claude runner like we did for Gemini, then switch profiler back
export const AGENT_MODELS = {
    company_finder: "gemini-2.0-flash",      // Discovery - cheap and fast
    company_profiler: "gemini-2.0-flash",    // TEMP: Gemini until direct Claude runner built
    apollo_lead_finder: "gemini-2.0-flash",  // Structured queries - simple task
    outreach_creator: "gemini-2.0-flash",    // Copy generation - scales cheaply
    data_architect: "gemini-2.0-flash",      // Data normalization - simple task
    default: "gemini-2.0-flash"
};

export const getEffectiveMaxLeads = () => {
    return IS_TESTING ? WORKFLOW_CONFIG.MAX_LEADS_TESTING : WORKFLOW_CONFIG.MAX_LEADS_PRODUCTION;
};
