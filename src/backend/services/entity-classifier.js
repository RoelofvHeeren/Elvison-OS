/**
 * Entity Classification Service
 * 
 * Two-stage FO qualification pipeline:
 * Step A: Hard entity classification
 * Step B: ICP match scoring (separate)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { runFamilyOfficeFirewall } from './fo-firewall.js';

const genAI = new GoogleGenerativeAI(
    process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
);

const ENTITY_CLASSIFICATION_SCHEMA = `
You are a strict entity classifier for real estate investment discovery.
Analyze the company information and output ONLY valid JSON matching this schema:

{
    "entity_type": "FAMILY_OFFICE_SFO|FAMILY_OFFICE_MFO_PRINCIPAL|FAMILY_OFFICE_CAPITAL_VEHICLE|WEALTH_MANAGER_MFO|WEALTH_MANAGER|INVESTMENT_FUND|SERVICE_PROVIDER|OPERATOR|REIT|UNKNOWN",
    "confidence": 0.0-1.0,
    "signals_positive": ["signal1", "signal2"],
    "signals_negative": ["signal1", "signal2"],
    "reason": "Explanation"
}

STRICT CLASSIFICATION RULES (PROBABILISTIC SIGNALS):

1. FAMILY_OFFICE_SFO (Approved):
   - Single Family Office.
   - Signals: "family office for the X family", "investing the capital of the X family".

2. FAMILY_OFFICE_MFO_PRINCIPAL (Approved):
   - Multi-Family Office acting as a PRINCIPAL INVESTOR.
   - Signals: "direct investments", "principal capital", "co-invest", "balance sheet".
   - MUST show evidence of investing OWN/PARTNERS' money, not just managing client accounts.

3. FAMILY_OFFICE_CAPITAL_VEHICLE (Approved):
   - Holding Company or Investment Office.
   - Doesn't strictly say "family office" but invests proprietary capital.
   - Signals: "private investment office", "family capital", "generational capital", "holding company".

4. WEALTH_MANAGER_MFO (REJECT):
   - Calls itself "Multi-Family Office" but is effectively a Wealth Manager.
   - Signals: "comprehensive wealth solutions", "legacy planning", "trust services", "fiduciary", "serving HNW families".
   - CTA: "Become a client".

5. WEALTH_MANAGER (REJECT):
   - Standard RIA / Financial Planner.
   - Signals: "financial planning", "retirement", "client portal", "AUM for clients".

6. INVESTMENT_FUND (REJECT):
   - PE Firm or Fund Manager raising 3rd party LP capital.
   - Signals: "Fund I", "Fund II", "Investors Login", "Capital Raising".

7. SERVICE_PROVIDER (REJECT):
   - Consultants, OCIOs, Software, Legal.
   - Signals: "Outsourced CIO", "Fund Administration", "Consulting".

OUTPUT RULES:
- Output ONLY the JSON object.
- Use "signals_positive" for evidence of PROPRIETARY/DIRECT investment.
- Use "signals_negative" for evidence of ADVISORY/SERVICE model.
`;

/**
 * Classify entity type using AI
 * First runs firewall heuristics (free), then AI if needed
 */
export async function classifyEntity(companyName, companyText = '', domain = '') {
    // Step 1: Run free firewall heuristics first
    const firewall = runFamilyOfficeFirewall(companyName, companyText, domain);

    if (firewall.decision === 'REJECT') {
        return {
            entity_type: firewall.entity_type,
            entity_subtype: 'UNKNOWN',
            confidence: firewall.confidence,
            signals_positive: [],
            signals_negative: [firewall.reason],
            reason: firewall.reason,
            source: 'firewall_heuristic',
            cost: 'free'
        };
    }

    if (firewall.decision === 'PASS') {
        return {
            entity_type: firewall.entity_type,
            entity_subtype: firewall.entity_type === 'FAMILY_OFFICE' ? 'UNKNOWN' : 'UNKNOWN',
            confidence: firewall.confidence,
            signals_positive: firewall.reason.split(':')[1]?.split(',') || [],
            signals_negative: [],
            reason: firewall.reason,
            source: 'firewall_heuristic',
            cost: 'free'
        };
    }

    // Step 2: Run AI classification for UNCERTAIN cases
    const prompt = `
${ENTITY_CLASSIFICATION_SCHEMA}

Company: ${companyName}
Website: ${domain}
Profile: ${companyText.substring(0, 2000)}

Classify this company:
`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        // Parse JSON response
        let classification;
        try {
            // Try direct parse
            classification = JSON.parse(text);
        } catch (e) {
            // Try extracting JSON from markdown
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                classification = JSON.parse(match[0]);
            } else {
                throw new Error('Invalid JSON response from model');
            }
        }

        return {
            ...classification,
            source: 'llm_classification',
            cost: 'gemini_call'
        };

    } catch (err) {
        console.error('Entity classification error:', err);
        return {
            entity_type: 'UNKNOWN',
            entity_subtype: 'UNKNOWN',
            confidence: 0.0,
            signals_positive: [],
            signals_negative: [err.message],
            reason: `Classification failed: ${err.message}`,
            source: 'error',
            cost: 'error'
        };
    }
}

/**
 * Step B: FO specific ICP match scoring
 * Only called after entity passes Step A with entity_type = FAMILY_OFFICE
 */
export async function scoreFOMatch(companyName, companyProfile = '', geography = '', isSFO = null) {
    const prompt = `
You are a specialist in family office investment matching.
Evaluate this family office's fit for a real estate investment partnership.

Company: ${companyName}
Profile: ${companyProfile.substring(0, 2000)}
Geography: ${geography || 'Unknown'}
Presumed Type: ${isSFO === null ? 'Unknown' : isSFO ? 'Single Family Office' : 'Multi-Family Office'}

Output ONLY valid JSON:
{
    "match_score": 0-10,
    "confidence": 0.0-1.0,
    "fit_reasons": ["reason1", "reason2"],
    "geo_match": true|false,
    "asset_focus": ["real_estate", "venture", "credit", "infra", "mixed"],
    "capital_indicators": ["principal capital", "direct investment", "portfolio company", "acquisition"],
    "recommendation": "APPROVED|REVIEW|REJECTED"
}

SCORING RULES FOR FAMILY OFFICES:
- FOs get credit for ANY signals of proprietary capital deployment
- Minimal profile is acceptable (many FOs are private)
- Score on: geo match, asset alignment, capital evidence

Approved: score >= 6
Review: score 4-5
Rejected: score <= 3
`;

    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        let scoreData;
        try {
            scoreData = JSON.parse(text);
        } catch (e) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                scoreData = JSON.parse(match[0]);
            } else {
                throw new Error('Invalid JSON response');
            }
        }

        return {
            ...scoreData,
            source: 'fo_match_scorer',
            cost: 'gemini_call'
        };

    } catch (err) {
        console.error('FO match scoring error:', err);
        return {
            match_score: 0,
            confidence: 0.0,
            fit_reasons: [],
            geo_match: false,
            asset_focus: [],
            capital_indicators: [],
            recommendation: 'REJECTED',
            error: err.message,
            source: 'error',
            cost: 'error'
        };
    }
}

/**
 * Combined two-stage classification for Family Office pipeline
 * Returns: { classification, score, recommendation, fo_status }
 */
export async function classifyAndScoreFO(companyName, companyProfile = '', domain = '', geography = '') {
    // Step A: Entity Classification (hard gate)
    const classification = await classifyEntity(companyName, companyProfile, domain);

    // Early rejection if not FO
    if (classification.entity_type !== 'FAMILY_OFFICE' && classification.entity_type !== 'UNKNOWN') {
        return {
            classification,
            score: null,
            recommendation: 'REJECTED',
            reason: `Not a family office: ${classification.entity_type}`,
            fo_status: 'REJECTED',
            cost: classification.cost
        };
    }

    // For UNKNOWN with high enough confidence, might try to score anyway
    if (classification.entity_type === 'UNKNOWN') {
        if (classification.confidence < 0.6) {
            return {
                classification,
                score: null,
                recommendation: 'REJECTED',
                reason: `Insufficient confidence for FO classification: ${classification.confidence}`,
                fo_status: 'REJECTED',
                cost: classification.cost
            };
        }
        // If confidence >= 0.6, try scoring
    }

    // Step B: FO Match Scoring (soft gate)
    const isSFO = classification.entity_subtype === 'SFO' || classification.entity_subtype === 'UNKNOWN';
    const score = await scoreFOMatch(companyName, companyProfile, geography, isSFO);

    // Determine final fo_status
    let fo_status = 'UNKNOWN';
    if (score.recommendation === 'APPROVED' || score.match_score >= 6) {
        fo_status = 'APPROVED';
    } else if (score.recommendation === 'REVIEW' || (score.match_score >= 4 && score.match_score < 6)) {
        fo_status = 'REVIEW';
    } else {
        fo_status = 'REJECTED';
    }

    return {
        classification,
        score,
        recommendation: score.recommendation,
        fo_status: fo_status,
        total_cost: `${classification.cost} + ${score.cost}`,
        combined_confidence: (classification.confidence + score.confidence) / 2
    };
}

export default {
    classifyEntity,
    scoreFOMatch,
    classifyAndScoreFO,
    ENTITY_CLASSIFICATION_SCHEMA
};
