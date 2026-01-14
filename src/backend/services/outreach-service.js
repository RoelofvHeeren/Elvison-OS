import { GeminiModel, extractJson } from './gemini.js';

// V4.5 CONSTANTS (10/10 Standard)
const OPENERS = [
    "I came across",
    "I was looking at",
    "I noticed",
    "I was reviewing"
];

const CLOSERS = [
    "thought connecting could be worthwhile",
    "thought it could be useful to connect",
    "worth connecting if there’s overlap",
    "thought it made sense to connect"
];

// Tier 1: Investor Intent
const TIER_1_KEYWORDS = [
    'invests', 'investment', 'acquires', 'acquisition', 'fund', 'strategy',
    'co invest', 'co-invest', 'joint venture', 'portfolio', 'asset management',
    'private equity', 'real estate equity', 'LP', 'GP', 'partner capital'
];

// Tier 2: Residential Relevance
const TIER_2_KEYWORDS = [
    'residential', 'multi suite', 'multi-suite', 'purpose built rental',
    'rental housing', 'multifamily', 'multi-family', 'apartments', 'housing',
    'condo', 'condominium', 'condo development', 'student housing', 'senior living', 'SFR', 'single family rental'
];

// Tier 3: Direct Investing Evidence (The "Real Investor" Gate)
const TIER_3_KEYWORDS = [
    'acquired', 'portfolio', 'we invest', 'capital deployed',
    'co-invest', 'direct investments', 'investment platform', 'holdings',
    'assets under management', 'aum' // Allowed as evidence of scale/investing, just not as the hook
];

const BANNED_OUTPUT_WORDS = [
    'AUM', 'offices', 'global reach', 'international', 'years in business',
    'award', 'congrats', 'impressed', 'synergies', 'quick call', 'hop on a call',
    'Head of', 'Managing Director', 'CEO', 'Principal'
];

export class OutreachService {
    static async createLeadMessages({ company_name, website, company_profile, fit_score, icp_type }) {
        try {
            // === 1. MANDATORY LEAD QUALIFICATION GATE ===
            // 2.2 Disallowed company types (AUTO SKIP)
            const SKIP_TYPES = [
                'BROKERAGE', 'ADVISORY', 'CONSULTING', 'AGENCY',
                'SERVICE', 'TECH', 'VENDOR', 'PROPERTY_MANAGEMENT'
            ];

            if (icp_type && SKIP_TYPES.some(t => icp_type.toUpperCase().includes(t))) {
                return this._createSkipResponse(`ICP Type '${icp_type}' is disqualified (Brokerage/Service).`);
            }

            // === 3. RESIDENTIAL INVESTOR RELEVANCE GATE ===
            if (!company_profile) {
                return this._createSkipResponse("No profile available.");
            }

            const profileLower = company_profile.toLowerCase();
            const hasTier1 = TIER_1_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));
            const hasTier2 = TIER_2_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));
            const hasTier3 = TIER_3_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));

            if (!hasTier1 || !hasTier2) {
                return this._createSkipResponse("Failed Keyword Gate: Needs clear Investor + Residential keywords.");
            }

            if (!hasTier3) {
                return this._createSkipResponse("Failed Tier 3 Gate: No evidence of direct investing (acquired, portfolio, capital deployed).");
            }

            // === 4. RANDOMIZATION ===
            const opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
            const closer = CLOSERS[Math.floor(Math.random() * CLOSERS.length)];

            // === 5. SELECT PROMPT BASED ON ICP ===
            const isFamilyOffice = icp_type && icp_type.toUpperCase().includes('FAMILY_OFFICE');

            let PROMPT_INSTRUCTIONS = "";

            if (isFamilyOffice) {
                PROMPT_INSTRUCTIONS = `
You are writing outreach on behalf of Roelof van Heeren at Fifth Avenue Properties.
TARGET: A Single or Multi-Family Office.
TONE: Extremely discrete, direct, peer-to-peer. NO sales fluff.
Instructions:
1. Identify if they are an SFO or MFO.
2. Extract ONE research fact (Deal > Thesis).
3. If they are a Family Office, DO NOT treat them like a large institutional fund (avoid "institutional" jargon if possible).
`;
            } else {
                PROMPT_INSTRUCTIONS = `
You are writing outreach on behalf of Roelof van Heeren at Fifth Avenue Properties.
TARGET: An Institutional Investment Firm (PE, REIT, Pension).
TONE: Professional, competent, peer-to-peer.
Instructions:
1. Extract ONE research fact (Deal > Thesis).
`;
            }

            const MASTER_PROMPT = `
${PROMPT_INSTRUCTIONS}

CORE RULES:
- Use the provided company_profile as the only source of truth.
- Apply mandatory gating: skip brokerages, advisory firms, agencies.
- Extract exactly one research fact using this hierarchy: 
    1. Named deal/project/asset (Specific name like "Alpine Village")
    2. Residential investment thesis (e.g. "ground up multifamily in Texas")
    3. Residential portfolio scale (e.g. "22,000 apartment units")
    4. General residential focus
- BANNED FACTS: AUM, global reach, number of offices, years in business, awards, transaction volume.
- NEVER invent deals or use placeholders like "123 Main Street".

TEMPLATE LOGIC (STRICT):
You must classify the extracted fact as either "DEAL" (specific named asset/project) or "THESIS" (general strategy/market focus).

IF FACT_TYPE = "DEAL":
Use this exact structure:
"Hi {First_name}, ${opener} {extracted_fact}. We frequently develop similar projects at Fifth Avenue Properties and often partner with groups deploying long-term capital. ${closer}."

IF FACT_TYPE = "THESIS":
Use this exact structure:
"Hi {First_name}, ${opener} {extracted_fact}. We work on similar residential strategies at Fifth Avenue Properties and often partner with groups deploying long-term capital. ${closer}."

NO OTHER VARIATIONS. DO NOT MIX MATCH.

OUTPUT FORMAT (JSON ONLY):
{
  "status": "SUCCESS" | "SKIP",
  "skip_reason": "string",
  "research_fact_type": "DEAL" | "THESIS" | "SCALE" | "GENERAL",
  "research_fact": "string",
  "linkedin_message": "string",
  "email_subject": "string",
  "email_body": "string"
}

EMAIL RULES:
Subject: Introduction | Residential Development (Canada)
Body:
Hi {First_name},
${opener} {Company_Name} and {research_fact}.
[Insert Alignment Sentence based on FACT_TYPE logic here]
If it makes sense, I’m happy to share more information about our current projects.
Best regards,
Roelof van Heeren
Fifth Avenue Properties
`;

            const inputContext = `
Company: ${company_name}
Profile:
"""
${company_profile}
"""
`;

            // === 6. CALL LLM ===
            const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
            const model = new GeminiModel(apiKey, 'gemini-2.0-flash');

            const response = await model.getResponse({
                systemInstructions: MASTER_PROMPT,
                input: inputContext
            });

            const outputItem = response.output.find(i => i.type === 'message');
            const outputText = outputItem?.content?.[0]?.text;

            if (!outputText) throw new Error("No output from model");

            let result;
            try {
                result = JSON.parse(extractJson(outputText));
            } catch (e) {
                throw new Error("Invalid JSON from model");
            }

            if (result.status === 'SKIP') {
                return this._createSkipResponse(result.skip_reason);
            }

            // === 7. POST GENERATION QA ===
            const checkString = (result.linkedin_message + result.email_body).toLowerCase();
            const violation = BANNED_OUTPUT_WORDS.find(word => checkString.includes(word.toLowerCase()));

            if (violation) {
                return this._createSkipResponse(`QA FAILED: Banned word detected ('${violation}')`);
            }

            return result;

        } catch (error) {
            console.error('[OutreachService] generation failed:', error);
            return {
                linkedin_message: "[GENERATION_FAILED]",
                email_subject: "Error",
                email_body: `Generation failed: ${error.message}`
            };
        }
    }

    static _createSkipResponse(reason) {
        return {
            linkedin_message: `[SKIPPED: ${reason}]`,
            email_subject: `[SKIPPED]`,
            email_body: `[SKIPPED: ${reason}]`
        };
    }
}
