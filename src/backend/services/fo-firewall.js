/**
 * Family Office Firewall
 * 
 * Deterministic wealth manager rejection layer
 * Runs before expensive LLM calls to eliminate obvious non-FO entities
 */

const WEALTH_MANAGER_HEURISTICS = [
    /wealth\s+management/i,
    /financial\s+planning/i,
    /our\s+clients/i,
    /RIA\b/i, // strict word boundary
    /registered\s+investment\s+adviser/i,
    /registered\s+investment\s+advisor/i,
    /FINRA/i,
    /Form\s+ADV/i,
    /private\s+wealth/i,
    /wealth\s+advisor/i,
    /family\s+office\s+services/i,
    /relationship\s+manager/i,
    /portfolio\s+manager/i,
    /assets\s+under\s+management\s+for\s+clients/i,
    /financial\s+advisory/i,
    /fiduciary/i,
    /retirement\s+planning/i,
    /insurance\s+solutions/i,
    /financial\s+advisor/i,
    /portfolio\s+management\s+services/i,
    /investment\s+advisory/i,
    /fee.?based\s+planning/i,
    /wealth\s+advisors?/i,
    /private\s+banking/i,
    /trust\s+services/i,
    /estate\s+planning/i,
    // Service CTAs - Strong signal of a service firm
    /become\s+a\s+client/i,
    /our\s+services/i,
    /schedule\s+(a\s+)?consultation/i,
    /client\s+login/i,
    /start\s+your\s+journey/i
];

const INVESTMENT_FUND_HEURISTICS = [
    /registered\s+investment\s+company/i,
    /open.?end\s+fund/i,
    /mutual\s+fund/i,
    /exchange.?traded\s+fund/i,
    /ETF/i,
    /fund\s+manager.*clients/i,
    /asset\s+management\s+company/i,
    /investment\s+firm\s+managing\s+third.?party/i
];

const FAMILY_OFFICE_POSITIVE_SIGNALS = [
    /single\s+family\s+office/i,
    /multi.?family\s+office/i,
    /family\s+office/i,
    /private\s+investment\s+office/i,
    /investment\s+office.*principal/i,
    /principal\s+investments/i,
    /holding\s+company.*private\s+invest/i,
    /holding\s+company.*family/i,
    /family\s+capital/i,
    /family\s+holdings/i,
    /proprietary\s+capital/i,
    /private\s+capital.*family/i,
    /direct\s+investment.*family/i,
    /office\s+of\s+the\s+family/i,
    /family\s+investment\s+vehicle/i,
    /family\s+name.*principal/i,
    /surname.*office/i,
    /surname.*capital/i
];

/**
 * Check if a company text/domain is obviously a wealth manager
 * Returns { is_wealth_manager, confidence, reason }
 */
export function isWealthManagerHeuristic(companyText = '', domain = '') {
    const combined = `${companyText} ${domain}`.toLowerCase();

    // Check against wealth manager patterns
    for (const pattern of WEALTH_MANAGER_HEURISTICS) {
        if (pattern.test(combined)) {
            return {
                is_wealth_manager: true,
                confidence: 0.95,
                reason: `Strong wealth management signal: ${pattern.source}`
            };
        }
    }

    return {
        is_wealth_manager: false,
        confidence: 0.0,
        reason: 'No wealth manager heuristics matched'
    };
}

/**
 * Check if text looks like an investment fund (vs family office)
 */
export function isInvestmentFundHeuristic(companyText = '', domain = '') {
    const combined = `${companyText} ${domain}`.toLowerCase();

    for (const pattern of INVESTMENT_FUND_HEURISTICS) {
        if (pattern.test(combined)) {
            return {
                is_investment_fund: true,
                confidence: 0.90,
                reason: `Strong fund signal: ${pattern.source}`
            };
        }
    }

    return {
        is_investment_fund: false,
        confidence: 0.0,
        reason: 'No fund heuristics matched'
    };
}

/**
 * Quick positive signal check for family offices
 * Returns { has_fo_signals, signal_count, signals }
 */
export function hasFamilyOfficeSignals(companyText = '', domain = '') {
    const combined = `${companyText} ${domain}`.toLowerCase();
    const signals = [];

    for (const pattern of FAMILY_OFFICE_POSITIVE_SIGNALS) {
        if (pattern.test(combined)) {
            signals.push(pattern.source);
        }
    }

    return {
        has_fo_signals: signals.length > 0,
        signal_count: signals.length,
        signals: signals
    };
}

/**
 * Main firewall check - returns early decision with high confidence
 * 
 * Returns: {
 *   decision: 'REJECT' | 'PASS' | 'UNCERTAIN',
 *   entity_type: 'WEALTH_MANAGER' | 'INVESTMENT_FUND' | 'FAMILY_OFFICE' | 'UNKNOWN',
 *   confidence: float 0-1,
 *   reason: string,
 *   cost: 'free' // All heuristics are free, no LLM calls
 * }
 */
export function runFamilyOfficeFirewall(companyName = '', companyText = '', domain = '') {
    // Step 1: Check for obvious wealth manager
    const wmCheck = isWealthManagerHeuristic(companyText, domain);
    if (wmCheck.is_wealth_manager) {
        return {
            decision: 'REJECT',
            entity_type: 'WEALTH_MANAGER',
            confidence: wmCheck.confidence,
            reason: wmCheck.reason,
            cost: 'free'
        };
    }

    // Step 2: Check for obvious investment fund (unless it's family capital)
    const ifCheck = isInvestmentFundHeuristic(companyText, domain);
    if (ifCheck.is_investment_fund) {
        // Exception: If it says "family capital" it might be a fund managed by FO
        if (!/family\s+capital/i.test(`${companyText} ${domain}`)) {
            return {
                decision: 'REJECT',
                entity_type: 'INVESTMENT_FUND',
                confidence: ifCheck.confidence,
                reason: ifCheck.reason,
                cost: 'free'
            };
        }
    }

    // Step 3: Check for positive FO signals
    const foSignals = hasFamilyOfficeSignals(companyText, domain);
    if (foSignals.has_fo_signals) {
        return {
            decision: 'PASS',
            entity_type: 'FAMILY_OFFICE',
            confidence: Math.min(0.8, foSignals.signal_count * 0.25),
            reason: `FO signals found: ${foSignals.signals.slice(0, 2).join(', ')}`,
            cost: 'free'
        };
    }

    // Step 4: Uncertain - needs LLM classification
    return {
        decision: 'UNCERTAIN',
        entity_type: 'UNKNOWN',
        confidence: 0.0,
        reason: 'No strong heuristic signals. Requires LLM classification.',
        cost: 'llm_required'
    };
}

export default {
    isWealthManagerHeuristic,
    isInvestmentFundHeuristic,
    hasFamilyOfficeSignals,
    runFamilyOfficeFirewall
};
