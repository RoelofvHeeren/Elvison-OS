
export const JOB_TITLE_SUGGESTIONS = [
    "CEO", "Founder", "Co-Founder", "CTO", "CIO", "VP of Sales", "VP of Engineering",
    "Director of Marketing", "Product Manager", "Head of Growth", "Sales Director"
]

export const COUNTRY_SUGGESTIONS = [
    "United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Netherlands",
    "Sweden", "Singapore", "United Arab Emirates", "Global (with local exposure)"
]

export const ORG_TYPE_OPTIONS = [
    "Enterprise / Public Company",
    "Small & Medium Business (SMB)",
    "Startup / Scale-up",
    "Private Equity / Venture Capital",
    "Government / Public Sector",
    "Non-Profit / NGO",
    "Agency / Consultancy"
]

export const JOB_FUNCTION_OPTIONS = [
    "Executive / Leadership",
    "Sales / Revenue",
    "Marketing / Growth",
    "Product / Engineering",
    "Operations",
    "Finance",
    "HR / People",
    "Legal"
]

export const EXCLUDED_FUNCTION_OPTIONS = [
    "Entry Level / Interns",
    "Support / Admin",
    "Recruiting / Talent",
    "Students"
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
    "Direct Sales / Customer Acquisition (High Strictness)",
    "Partnership / Channel Development (Medium Strictness)",
    "Market Research / Analysis (Low Strictness)",
    "Recruiting / Headhunting"
]

export const DATA_FIELD_OPTIONS = [
    "First Name", "Last Name", "Title", "Company Name", "Company Website",
    "LinkedIn URL", "Email", "Phone Number", "Location", "Industry"
]

export const CHANNEL_OPTIONS = [
    "LinkedIn", "Email", "Instagram", "Facebook", "Other"
]

export const STRICTNESS_OPTIONS = [
    "Strict - Only exact ICP matches (e.g., only real estate investment firms, no adjacent industries)",
    "Moderate - Include similar/adjacent companies (e.g., mortgage lenders, property developers)",
    "Flexible - Broad matches within the general sector (e.g., any financial services company)"
]

export const AGENTS = [
    {
        id: 'company_finder',
        name: 'Company Finder',
        description: 'Define your strictly qualified Ideal Customer Profile (ICP).',
        questions: [
            { id: 'icp_description', label: 'Describe your Ideal Customer in one paragraph', type: 'textarea', placeholder: 'e.g. "We target Canadian real estate investment firms with $50M+ in assets under management, focused on residential multi-family properties. They should have an active acquisition strategy and be open to joint ventures with developers."', helper: 'Write a natural description of your perfect customer. Be specific about industry, size, geography, and what makes them a good fit.' },
            { id: 'strictness', label: 'How strict should we be with your ICP?', type: 'radio', options: STRICTNESS_OPTIONS, helper: 'Strict = fewer but more accurate results. Flexible = more results but may include less relevant companies.' },
            { id: 'org_types', label: 'Target Industries / Sectors', type: 'multi-select', options: ORG_TYPE_OPTIONS, helper: 'Select all that apply.' },
            { id: 'excluded_industries', label: 'Excluded Industries (Strictly Avoid)', type: 'textarea', placeholder: 'e.g. "Restaurants, Food & Beverage, Small retail shops, Local service businesses"', helper: 'List company types or industries to NEVER include, even if they appear in search results.' },
            { id: 'geography', label: 'Geographic Scope', type: 'multi-select', options: COUNTRY_SUGGESTIONS, helper: 'Where are they headquartered?' },
            { id: 'quality_bar', label: 'Additional Criteria', placeholder: 'e.g. "Revenue > $10M", "Using HubSpot", "Recently funded"', type: 'textarea' },
        ],
        template: (a) => `You are an expert lead researcher. Find companies matching this strict profile:
ICP Description: ${a.icp_description || 'Not provided'}
Strictness Level: ${a.strictness || 'Moderate'}
Org Types: ${Array.isArray(a.org_types) ? a.org_types.join(', ') : a.org_types}
EXCLUDED Industries (NEVER include): ${a.excluded_industries || 'None specified'}
Geo: ${Array.isArray(a.geography) ? a.geography.join(', ') : a.geography}
Quality Bar: ${a.quality_bar}
Output the list in JSON format.`
    },
    {
        id: 'company_profiler',
        name: 'Company Profiler',
        description: 'Verify companies against your strict intent.',
        questions: [
            { id: 'key_attributes', label: 'Must-Have Attributes', placeholder: 'e.g. "Active blog", "Hiring for Sales", "Uses Shopify"', type: 'textarea' },
            { id: 'red_flags', label: 'Deal-Breakers / Red Flags', placeholder: 'e.g. "Competitor products", "Negative reviews", "No website"', type: 'textarea' },
            { id: 'depth', label: 'Analysis Depth', type: 'radio', options: ['Quick Scan (Homepage)', 'Deep Dive (News, LinkedIn, Reports)'] },
            { id: 'profile_content', label: 'What info do you want in company profiles?', placeholder: 'e.g. "Assets under management, investment focus areas, recent deals, team size, geographic presence"', type: 'textarea', helper: 'Describe specific data points you want extracted for each company (4-10 sentences will be generated).' },
            { id: 'manual_research', label: 'How would you manually research a site?', placeholder: 'Describe how you manually find info (e.g. "I look for a Portfolio page and count assets...")', type: 'textarea', helper: 'Give specific instructions on where to look and what to verify.' },
        ],
        template: (a) => `You are a Research Analyst. Profile these companies.
Attributes: ${a.key_attributes}
Red Flags: ${a.red_flags}
Depth: ${a.depth}
Profile Content: ${a.profile_content}
Manual Research Instructions: ${a.manual_research}
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
        description: 'Generate personalized outreach messages that get replies.',
        questions: [
            {
                id: 'prompt_instructions',
                label: 'AI System Instructions / Prompt',
                placeholder: 'Enter the full system instructions for the AI...',
                type: 'textarea',
                helper: 'This is the EXACT prompt the AI will use. Reference "Roelof van Heeren" and "Fifth Avenue Properties" here directly.'
            }
        ],
        template: (a) => a.prompt_instructions || "Default instructions..."
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
