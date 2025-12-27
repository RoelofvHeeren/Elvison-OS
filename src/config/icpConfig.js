
export const JOB_TITLE_SUGGESTIONS = [
    "CEO", "Founder", "Co-Founder", "CTO", "CIO", "VP of Sales", "VP of Engineering",
    "Director of Marketing", "Product Manager", "Head of Growth", "Sales Director"
]

export const COUNTRY_SUGGESTIONS = [
    "United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Netherlands",
    "Sweden", "Singapore", "United Arab Emirates", "Global (with local exposure)"
]

export const ORG_TYPE_OPTIONS = [
    "Family Office",
    "Private Equity Firm",
    "Real Estate Investment Manager",
    "Pension Fund",
    "Institutional Asset Manager",
    "Debt Fund / Mortgage Fund",
    "Developer Operator",
    "Venture Capital Firm",
    "Hedge Fund",
    "Sovereign Wealth Fund"
]

export const JOB_FUNCTION_OPTIONS = [
    "Investments",
    "Acquisitions",
    "Portfolio Management",
    "Capital Markets",
    "Private Equity",
    "Fund Management",
    "Development",
    "Finance / Treasury"
]

export const EXCLUDED_FUNCTION_OPTIONS = [
    "HR / People",
    "Marketing / Communications",
    "Operations / Admin",
    "IT / Technology",
    "Legal / Compliance",
    "Client Services / IR",
    "Sales / Business Development",
    "Enterprise Solutions"
]

export const SENIORITY_OPTIONS = [
    "Partner / Principal",
    "C-Level (CEO, CIO, COO)",
    "Managing Director",
    "VP / Director",
    "Head of X",
    "Manager / Associate"
]

export const INTENT_OPTIONS = [
    "Direct Capital Allocation (High Strictness)",
    "Strategic Partnerships (Medium Strictness)",
    "Deal Sourcing (Medium Strictness)",
    "Market Mapping (Low Strictness / Broad)"
]

export const DATA_FIELD_OPTIONS = [
    "First Name", "Last Name", "Title", "Company Name", "Company Website",
    "LinkedIn URL", "Email", "Phone Number", "Location", "Industry"
]

export const CHANNEL_OPTIONS = [
    "LinkedIn", "Email", "Instagram", "Facebook", "Other"
]

export const AGENTS = [
    {
        id: 'company_finder',
        name: 'Company Finder',
        description: 'Define your strictly qualified Ideal Customer Profile (ICP).',
        questions: [
            { id: 'org_types', label: 'Target Organization Types', type: 'multi-select', options: ORG_TYPE_OPTIONS, helper: 'Select all that apply.' },
            { id: 'geography', label: 'Geographic Scope', type: 'multi-select', options: COUNTRY_SUGGESTIONS, helper: 'Where must they be based or investing?' },
            { id: 'allocator_types', label: 'Institutional Allocators?', type: 'radio', options: ['Include Large Allocators (Pension/Sovereign)', 'Exclude Large Allocators (Private Capital Only)'] },
            { id: 'intent', label: 'Outreach Intent Strategy', type: 'radio', options: INTENT_OPTIONS, helper: 'This determines how strict our filtering is.' },
            { id: 'quality_bar', label: 'Quality / Niche Criteria', placeholder: 'e.g. "AUM > $100M", "Focus on Multifamily", "Must have ESG mandate"', type: 'textarea' },
        ],
        template: (a) => `You are an expert lead researcher. Find companies matching this strict profile:
Org Types: ${Array.isArray(a.org_types) ? a.org_types.join(', ') : a.org_types}
Geo: ${Array.isArray(a.geography) ? a.geography.join(', ') : a.geography}
Allocator Rule: ${a.allocator_types}
Intent: ${a.intent}
Quality Bar: ${a.quality_bar}
Output the list in JSON format.`
    },
    {
        id: 'company_profiler',
        name: 'Company Profiler',
        description: 'Verify companies against your strict intent.',
        questions: [
            { id: 'key_attributes', label: 'Must-Have Attributes', placeholder: 'e.g. "Must be an LP", "Must have invested in Canada"', type: 'textarea' },
            { id: 'red_flags', label: 'Deal-Breakers / Red Flags', placeholder: 'e.g. "Focuses only on Tech", "Defunct website", "Broker/Intermediary only"', type: 'textarea' },
            { id: 'depth', label: 'Analysis Depth', type: 'radio', options: ['Quick Scan (Homepage)', 'Deep Dive (News, LinkedIn, Reports)'] },
        ],
        template: (a) => `You are a Research Analyst. Profile these companies.
Attributes: ${a.key_attributes}
Red Flags: ${a.red_flags}
Depth: ${a.depth}
Verify against criteria.`
    },
    {
        id: 'apollo_lead_finder',
        name: 'Apollo Lead Finder',
        description: 'Define the exact Decision Makers to contact.',
        questions: [
            { id: 'seniority', label: 'Allowed Seniority Levels', type: 'multi-select', options: SENIORITY_OPTIONS, helper: 'Who has the authority you need?' },
            { id: 'job_functions', label: 'Target Job Functions', type: 'multi-select', options: JOB_FUNCTION_OPTIONS, helper: 'Which departments hold the budget/decision?' },
            { id: 'excluded_functions', label: 'Excluded Job Functions', type: 'multi-select', options: EXCLUDED_FUNCTION_OPTIONS, helper: 'Select departments to STRICTLY avoid (e.g. HR, Marketing).' }, // CRITICAL
            { id: 'job_titles', label: 'Specific Title Keywords (Optional)', type: 'multi-select', options: JOB_TITLE_SUGGESTIONS, helper: 'Add specific keywords if needed.' },
            { id: 'max_contacts', label: 'Max Contacts per Company', type: 'number', placeholder: '3' },
        ],
        template: (a) => `You are a data enrichment specialist. Find contacts.
Seniority: ${Array.isArray(a.seniority) ? a.seniority.join(', ') : a.seniority}
Functions: ${Array.isArray(a.job_functions) ? a.job_functions.join(', ') : a.job_functions}
Exclude: ${Array.isArray(a.excluded_functions) ? a.excluded_functions.join(', ') : a.excluded_functions}
Titles: ${Array.isArray(a.job_titles) ? a.job_titles.join(', ') : a.job_titles}
Max Contacts: ${a.max_contacts}
Use Apollo API.`
    },
    {
        id: 'outreach_creator',
        name: 'Outreach Creator',
        description: 'Generate outreach messages you actually want to send.',
        questions: [
            { id: 'template', label: 'Write your ideal first-message template', placeholder: 'Hi {{first_name}}, I noticed {{research_fact}}...', type: 'textarea' },
            { id: 'channels', label: 'Messaging channels', type: 'multi-select', options: CHANNEL_OPTIONS },
            { id: 'success_definition', label: 'What does a successful first message mean?', placeholder: 'What do you want the person to do?', type: 'textarea' },
        ],
        template: (a) => `You are an expert copywriter. Draft outreach messages.
Template: ${a.template}
Channels: ${Array.isArray(a.channels) ? a.channels.join(', ') : a.channels}
Goal: ${a.success_definition}
Create unique drafts.`
    },
    {
        id: 'data_architect',
        name: 'Data Architect',
        description: 'Confirm and extend your database structure.',
        isVisualEditor: true,
        questions: [],
        template: (a, columns) => `You are a CRM Data Architect.
Structure:
${columns.map(c => `- ${c.name} (${c.type})`).join('\n')}
Map incoming data to these fields.`
    },
    {
        id: 'research_framework',
        name: 'Research Framework',
        description: 'Teach the agent how to think and search.',
        questions: [
            { id: 'facts_to_mention', label: 'What facts would you like to mention in outreach?', placeholder: 'Facts that help personalize messages...', type: 'textarea' },
            { id: 'search_keywords', label: 'Keywords or Source Lists', placeholder: 'e.g. "Top family offices Canada"', type: 'textarea' },
            { id: 'manual_workflow', label: 'How would you do this manually?', placeholder: 'I\'d Google X, scan websites...', type: 'textarea' },
        ],
        template: (a) => `You are a market researcher.
Facts: ${a.facts_to_mention}
Keywords: ${a.search_keywords}
Workflow: ${a.manual_workflow}
Conduct deep analysis.`
    }
]
