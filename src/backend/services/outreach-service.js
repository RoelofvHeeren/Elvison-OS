/**
 * Outreach Service V5
 * 
 * Strict outreach generation with deterministic facts and reliable gating.
 * 
 * Contract:
 * - outreach_status: "SUCCESS" | "SKIP" | "NEEDS_RESEARCH" | "ERROR"
 * - If status != "SUCCESS", all message fields are null
 * - Message facts use strict alignment (no inventing)
 * - Banned phrases never appear in output
 * 
 * Gating Flow:
 * 1. Disqualified ICP types -> SKIP
 * 2. No profile -> SKIP
 * 3. Tier 2 (Residential keywords) required -> SKIP if missing
 * 4. Tier 1 (Investor keywords) by ICP type -> SKIP or NEEDS_RESEARCH
 * 5. Research fact extraction -> NEEDS_RESEARCH if unusable
 * 6. Message generation -> SUCCESS or NEEDS_RESEARCH (on QA failure)
 */

import { GeminiModel, extractJson } from './gemini.js';
import ResearchFactExtractor from './outreach/researchFactExtractor.js';

// Constants
const OPENERS = [
    "I came across",
    "I was looking at",
    "I noticed",
    "I was reviewing"
];

const CLOSERS = [
    "Thought connecting could be worthwhile",
    "Thought it could be useful to connect",
    "Worth connecting if there's overlap",
    "Thought it made sense to connect"
];

// Openers for full sentences (propositions) -> "I noticed that..."
const CLAUSE_OPENERS = [
    "I saw that",
    "I read that",
    "I noticed that",
    "I see that"
];

// Tier 1: Investor Intent (required for most)
// Tier 1: Investor Intent (required for most)
const TIER_1_KEYWORDS = [
    'invest', 'invests', 'investment', 'acquires', 'acquisition', 'fund', 'strategy',
    'co invest', 'co-invest', 'joint venture', 'portfolio', 'asset management',
    'private equity', 'real estate equity', 'lp', 'gp', 'partner capital',
    'investing', 'capital deployment', 'deploy capital'
];

// Tier 2: Residential Relevance (MANDATORY)
const TIER_2_KEYWORDS = [
    'residential', 'multifamily', 'multi-family', 'multi family', 'multi-suite',
    'apartment', 'apartments', 'purpose built rental', 'purpose-built rental',
    'rental housing', 'housing', 'condo', 'condominium', 'condo development',
    'student housing', 'senior living', 'sfr', 'single family rental',
    'apartment community', 'residential community', 'residential development'
];

// Tier 3: Direct Investing Evidence
const TIER_3_KEYWORDS = [
    'acquired', 'portfolio', 'we invest', 'capital deployed', 'deal', 'deals',
    'co-invest', 'direct investments', 'investment platform', 'holdings',
    'assets under management', 'aum', 'transaction', 'transactions',
    'deployment', 'invest in', 'invested in', 'invests in', 'invests directly',
    // Ticket 6: Family Office softer language
    'capital allocation', 'principal investments', 'private investments',
    'real assets', 'platform investments'
];

// Banned phrases in final output
const BANNED_OUTPUT_PHRASES = [
    'global reach',
    'years in business',
    'impressed',
    'congrats',
    'synergies',
    'quick call',
    'hop on a call',
    'schedule a call',
    'in your role as',
    'as ceo'
];

// Banned words for stricter filtering
const BANNED_OUTPUT_WORDS = [
    'aum', 'offices', 'international', 'award'
];

// Metrics collector
const METRICS = {
    success_count: 0,
    skip_count: 0,
    needs_research_count: 0,
    error_count: 0,
    skip_reasons: {},
    needs_research_reasons: {}
};

export class OutreachService {
    /**
     * Main generation method - strict contract enforcement
     */
    static async createLeadMessages({
        company_name,
        website,
        company_profile,
        fit_score,
        icp_type,
        first_name,
        // === Handle Custom Instructions (Manual Review Mode) ===
        if (instructions) {
            return this._generateCustomMessage(
                company_name,
                company_profile,
                first_name,
                person_name,
                instructions
            );
        }

// === Step 1: Extract Research Fact (Deterministic) ===
const factResult = ResearchFactExtractor.extract(
    company_profile,
    company_name,
    icp_type
);

// If fact extraction failed or returned nothing
if (!factResult.fact) {
    return this._createGatedResponse(
        'NEEDS_RESEARCH',
        factResult.reason.replace(/\s+/g, '_').toLowerCase(),
        factResult.reason
    );
}

// === Step 2: Generate Message ===
// At this point we have a valid research fact
const messageResult = this._generateMessage(
    company_name,
    factResult,
    first_name,
    person_name,
    icp_type
);

// Message generation failed
if (messageResult.outreach_status !== 'SUCCESS') {
    return messageResult;
}

// === Step 3: Post-Generation QA ===
const qaResult = this._performQA(messageResult);
if (qaResult.outreach_status !== 'SUCCESS') {
    return qaResult;
}

// === Success! Return complete message ===
METRICS.success_count++;
return {
    outreach_status: 'SUCCESS',
    outreach_reason: null,
    research_fact: factResult.fact,
    research_fact_type: factResult.fact_type,
    message_version: 'v5',
    profile_quality_score: factResult.confidence,
    linkedin_message: qaResult.linkedin_message,
    email_subject: qaResult.email_subject,
    email_body: qaResult.email_body
};

        } catch (error) {
    console.error('[OutreachService] Unexpected error:', error);
    METRICS.error_count++;
    return this._createGatedResponse(
        'ERROR',
        'generation_failed',
        `Unexpected error: ${error.message}`
    );
}
    }

    /**
     * Gate 1: Check for disqualified ICP types
     */
    static _checkDisqualifiedICP(icp_type) {
    const SKIP_TYPES = [
        'BROKERAGE', 'ADVISORY', 'CONSULTING', 'AGENCY',
        'SERVICE', 'TECH', 'VENDOR', 'PROPERTY_MANAGEMENT'
    ];

    if (icp_type && SKIP_TYPES.some(t => icp_type.toUpperCase().includes(t))) {
        const reason = `icp_type_disqualified`;
        return this._createGatedResponse(
            'SKIP',
            reason,
            `ICP Type '${icp_type}' is disqualified (Brokerage/Service/Advisory).`
        );
    }

    return null;
}

    /**
     * Gates 3 & 4: Check tier requirements
     */
    static _checkTierGates(profile, icp_type) {
    const profileLower = profile.toLowerCase();
    const hasTier1 = TIER_1_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));
    const hasTier2 = TIER_2_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));
    const hasTier3 = TIER_3_KEYWORDS.some(k => profileLower.includes(k.toLowerCase()));

    // Tier 2 is MANDATORY - no residential keywords = SKIP
    if (!hasTier2) {
        const reason = 'tier_2_missing';
        METRICS.skip_reasons[reason] = (METRICS.skip_reasons[reason] || 0) + 1;
        METRICS.skip_count++;
        return {
            outreach_status: 'SKIP',
            outreach_reason: 'No residential keywords found (Tier 2)',
            research_fact: null,
            research_fact_type: null,
            message_version: 'v5',
            profile_quality_score: null,
            linkedin_message: null,
            email_subject: null,
            email_body: null
        };
    }

    // Tier 1 depends on ICP type
    // Ticket 1: Fix Family Office detection bug - normalize ICP type properly
    const icp = (icp_type || '').toUpperCase().replace(/\s|-/g, '_');
    const isFamilyOffice =
        icp.includes('FAMILYOFFICE') ||
        icp.includes('FAMILY_OFFICE') ||
        (icp.includes('FAMILY') && icp.includes('OFFICE'));

    if (!hasTier1) {
        if (isFamilyOffice) {
            // Family offices: missing investor keywords = NEEDS_RESEARCH (not SKIP)
            const reason = 'tier_1_missing_family_office';
            METRICS.needs_research_reasons[reason] = (METRICS.needs_research_reasons[reason] || 0) + 1;
            METRICS.needs_research_count++;
            return {
                outreach_status: 'NEEDS_RESEARCH',
                outreach_reason: 'Family office with vague investor language - needs manual research',
                research_fact: null,
                research_fact_type: null,
                message_version: 'v5',
                profile_quality_score: null,
                linkedin_message: null,
                email_subject: null,
                email_body: null
            };
        } else {
            // Investment firms: missing investor keywords = SKIP
            const reason = 'tier_1_missing';
            METRICS.skip_reasons[reason] = (METRICS.skip_reasons[reason] || 0) + 1;
            METRICS.skip_count++;
            return {
                outreach_status: 'SKIP',
                outreach_reason: 'No investor keywords found (Tier 1)',
                research_fact: null,
                research_fact_type: null,
                message_version: 'v5',
                profile_quality_score: null,
                linkedin_message: null,
                email_subject: null,
                email_body: null
            };
        }
    }

    // Tier 3: If missing, route to NEEDS_RESEARCH (not SKIP)
    if (!hasTier3) {
        const reason = 'tier_3_missing';
        METRICS.needs_research_reasons[reason] = (METRICS.needs_research_reasons[reason] || 0) + 1;
        METRICS.needs_research_count++;
        return {
            outreach_status: 'NEEDS_RESEARCH',
            outreach_reason: 'No direct investing evidence found - needs deeper research',
            research_fact: null,
            research_fact_type: null,
            message_version: 'v5',
            profile_quality_score: null,
            linkedin_message: null,
            email_subject: null,
            email_body: null
        };
    }

    // All tiers passed
    return null;
}

    /**
     * Generate the outreach message
     */
    static _generateMessage(company_name, factResult, first_name, person_name, icp_type) {
    try {
        // Ticket 1: Fix Family Office detection bug
        const icp = (icp_type || '').toUpperCase().replace(/\s|-/g, '_');
        const isFamilyOffice =
            icp.includes('FAMILYOFFICE') ||
            icp.includes('FAMILY_OFFICE') ||
            (icp.includes('FAMILY') && icp.includes('OFFICE'));

        // Select opening/closing
        // Ticket 4: Use grammatically correct opener based on fact type
        // THESIS facts are usually full sentences ("Forum invests in..."), so they need "that" openers
        let opener;
        if (factResult.fact_type === 'THESIS') {
            opener = CLAUSE_OPENERS[Math.floor(Math.random() * CLAUSE_OPENERS.length)];
        } else {
            opener = OPENERS[Math.floor(Math.random() * OPENERS.length)];
        }

        const closer = CLOSERS[Math.floor(Math.random() * CLOSERS.length)];

        // Build template based on fact type
        // Ticket 3: Shortened templates to reduce character limit failures
        // V5.1 Optimization 6: Add "Fund Structure / JV Posture" micro-hook
        let messageTemplate;
        if (factResult.fact_type === 'DEAL') {
            messageTemplate = `Hi {First_name}, ${opener} ${factResult.fact}. We frequently develop similar projects at Fifth Avenue Properties and often partner with LP or co-GP capital. ${closer}.`;
        } else if (factResult.fact_type === 'THESIS') {
            messageTemplate = `Hi {First_name}, ${opener} ${factResult.fact}. We work on similar residential strategies at Fifth Avenue Properties and often partner with long-term investors. ${closer}.`;
        } else if (factResult.fact_type === 'SCALE') {
            messageTemplate = `Hi {First_name}, ${opener} ${factResult.fact}. We are active in this scale of residential development at Fifth Avenue Properties and often partner with LP or co-GP capital. ${closer}.`;
        } else {
            // GENERAL fallback
            messageTemplate = `Hi {First_name}, ${opener} ${company_name}'s focus on the residential sector. We are active developers in this space at Fifth Avenue Properties and thought connecting could be worthwhile.`;
        }

        // Format names
        const actualFirstName = first_name || (person_name ? person_name.split(' ')[0] : 'there');

        // Replace placeholders
        const linkedin_message = messageTemplate
            .replace(/{First_name}/g, actualFirstName)
            .replace(/{Company_Name}/g, company_name);

        // Email body (same as LinkedIn + intro)
        const email_body = `Hi ${actualFirstName},\n\n${linkedin_message}\n\nIf it makes sense, I'm happy to share more information about our current projects.\n\nBest regards,\nRoelof van Heeren\nFifth Avenue Properties`;

        const email_subject = `Introduction | Residential Development`;

        // Ensure message is under 300 chars
        if (linkedin_message.length > 300) {
            METRICS.needs_research_count++;
            // Ticket 5: Add specific reason for length failures
            return {
                outreach_status: 'NEEDS_RESEARCH',
                outreach_reason: `linkedin_too_long:${linkedin_message.length}`,
                research_fact: factResult.fact,
                research_fact_type: factResult.fact_type,
                message_version: 'v5',
                profile_quality_score: factResult.confidence,
                linkedin_message: null,
                email_subject: null,
                email_body: null
            };
        }

        return {
            outreach_status: 'SUCCESS',
            outreach_reason: null,
            research_fact: factResult.fact,
            research_fact_type: factResult.fact_type,
            message_version: 'v5',
            profile_quality_score: factResult.confidence,
            linkedin_message,
            email_subject,
            email_body
        };

    } catch (error) {
        console.error('[OutreachService] Message generation error:', error);
        METRICS.error_count++;
        return {
            outreach_status: 'ERROR',
            outreach_reason: 'Message generation failed',
            research_fact: factResult.fact,
            research_fact_type: factResult.fact_type,
            message_version: 'v5',
            profile_quality_score: factResult.confidence,
            linkedin_message: null,
            email_subject: null,
            email_body: null
        };
    }
}

    /**
     * Post-generation QA: Check for banned phrases
     */
    static _performQA(messageResult) {
    const combined = (messageResult.linkedin_message + messageResult.email_body).toLowerCase();

    // Check for banned phrases
    // Ticket 5: Add specific reasons for QA failures
    for (const phrase of BANNED_OUTPUT_PHRASES) {
        if (combined.includes(phrase.toLowerCase())) {
            return {
                outreach_status: 'NEEDS_RESEARCH',
                outreach_reason: `qa_banned_phrase:${phrase}`,
                research_fact: messageResult.research_fact,
                research_fact_type: messageResult.research_fact_type,
                message_version: messageResult.message_version,
                profile_quality_score: messageResult.profile_quality_score,
                linkedin_message: null,
                email_subject: null,
                email_body: null
            };
        }
    }

    // Check for banned words
    for (const word of BANNED_OUTPUT_WORDS) {
        if (combined.includes(word.toLowerCase())) {
            return {
                outreach_status: 'NEEDS_RESEARCH',
                outreach_reason: `qa_banned_word:${word}`,
                research_fact: messageResult.research_fact,
                research_fact_type: messageResult.research_fact_type,
                message_version: messageResult.message_version,
                profile_quality_score: messageResult.profile_quality_score,
                linkedin_message: null,
                email_subject: null,
                email_body: null
            };
        }
    }

    // QA passed
    return messageResult;
}

    /**
     * Create a gated response (SKIP, NEEDS_RESEARCH, ERROR)
     */
    static _createGatedResponse(status, reason, reasonText) {
    if (status === 'SKIP') {
        METRICS.skip_count++;
        METRICS.skip_reasons[reason] = (METRICS.skip_reasons[reason] || 0) + 1;
    } else if (status === 'NEEDS_RESEARCH') {
        METRICS.needs_research_count++;
        METRICS.needs_research_reasons[reason] = (METRICS.needs_research_reasons[reason] || 0) + 1;
    } else if (status === 'ERROR') {
        METRICS.error_count++;
    }

    return {
        outreach_status: status,
        outreach_reason: reasonText || reason,
        research_fact: null,
        research_fact_type: null,
        message_version: 'v5',
        profile_quality_score: null,
        linkedin_message: null,
        email_subject: null,
        email_body: null
    };
}

    /**
     * Get metrics summary for logging/observability
     */
    static getMetrics() {
    return {
        ...METRICS,
        total_generated: METRICS.success_count + METRICS.skip_count + METRICS.needs_research_count + METRICS.error_count
    };
}

    /**
     * Generate custom message using LLM with specific user instructions
     */
    static async _generateCustomMessage(company_name, company_profile, first_name, person_name, instructions) {
    try {
        const actualFirstName = first_name || (person_name ? person_name.split(' ')[0] : 'there');

        const prompt = `
            You are an expert outreach copywriter for Fifth Avenue Properties (Residential Developer).
            
            TASK: Write a LinkedIn connection request and an email based on the USER INSTRUCTIONS below.
            
            USER INSTRUCTIONS:
            "${instructions}"
            
            CONTEXT:
            - Recipient: ${actualFirstName} at ${company_name}
            - Company Profile: ${company_profile.substring(0, 3000)}
            
            CONSTRAINTS:
            - LinkedIn Message: STRICTLY UNDER 300 CHARACTERS. No exceptions.
            - Tone: Professional, direct, peer-to-peer. No fluff.
            - Sender: Roelof van Heeren (Principal at Fifth Avenue Properties)
            
            OUTPUT JSON ONLY:
            {
                "linkedin_message": "...",
                "email_subject": "...",
                "email_body": "..."
            }
            `;

        const model = new GeminiModel();
        const response = await model.generate(prompt);
        const json = extractJson(response);

        if (!json || !json.linkedin_message) {
            throw new Error('Failed to generate valid JSON from custom instructions');
        }

        // Ensure length limit
        if (json.linkedin_message.length > 300) {
            json.linkedin_message = json.linkedin_message.substring(0, 297) + '...';
        }

        return {
            outreach_status: 'SUCCESS',
            outreach_reason: 'manual_override', // special reason for metrics
            research_fact: 'Manual Instructions Used',
            research_fact_type: 'MANUAL',
            message_version: 'custom_v1',
            profile_quality_score: 100, // Manual override assumes high quality
            linkedin_message: json.linkedin_message,
            email_subject: json.email_subject || 'Introduction',
            email_body: json.email_body || json.linkedin_message
        };

    } catch (error) {
        console.error('Custom message generation failed:', error);
        return {
            outreach_status: 'ERROR',
            outreach_reason: `Custom generation failed: ${error.message}`,
            research_fact: null,
            research_fact_type: null,
            message_version: 'custom_failed',
            profile_quality_score: 0,
            linkedin_message: null,
            email_subject: null,
            email_body: null
        };
    }
}

    /**
     * Reset metrics
     */
    static resetMetrics() {
    METRICS.success_count = 0;
    METRICS.skip_count = 0;
    METRICS.needs_research_count = 0;
    METRICS.error_count = 0;
    METRICS.skip_reasons = {};
    METRICS.needs_research_reasons = {};
}
}

export default OutreachService;
