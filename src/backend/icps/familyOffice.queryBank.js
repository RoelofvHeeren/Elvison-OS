/**
 * Family Office Query Bank
 * 
 * Dedicated discovery queries for finding single and multi-family offices
 * Separated from investment fund queries to reduce noise
 */

export const FAMILY_OFFICE_QUERY_PATTERNS = {
    // Category 1: Direct FO terms
    directFO: [
        'single family office',
        'multi family office',
        'multi-family office',
        '"family office" investments',
        '"family office" capital',
    ],
    
    // Category 2: The sleeper goldmine terms (most effective for discovery)
    sleeper: [
        '"private investment office"',
        '"investment office" principal',
        '"principal investments" family',
        '"principal capital" investments',
        'holding company private investments real estate',
        'family holding company investments',
        'family holdings real estate',
    ],
    
    // Category 3: Holdings and capital patterns
    holdings: [
        '"holding company" "private investments"',
        '"holding company" "real estate"',
        '"family holdings" investments',
        '"family capital" investments',
        '"family capital" real estate',
        'family office holdings portfolio',
    ],
    
    // Category 4: Operator-style FO (many are developers)
    operatorFO: [
        'holding company real estate developer',
        'private family company real estate',
        'family operated real estate investments',
    ],
    
    // Category 5: Geographic + FO combos
    geographic: {
        canada: [
            'family office Canada real estate',
            '"private investment office" Toronto',
            '"family capital" Canada investments',
            'multi-family office Canada',
        ],
        us: [
            'single family office United States',
            'family office USA real estate',
            'SFO real estate investments',
        ],
        global: [
            'family office real estate international',
            'global family office capital',
        ]
    },
    
    // Category 6: Alternative entity types (often used by FO)
    alternativeStructures: [
        'family-led investment company',
        'family-controlled capital',
        'proprietor-owned investment firm',
        'founder-led investment office',
        'family enterprise office',
    ]
};

/**
 * Build a complete query with exclusions
 * Excludes wealth managers, advisors, RIAs, financial planners
 */
export function buildFamilyOfficeQuery(basePattern, geography = '', exclusions = []) {
    const defaultExclusions = [
        '-advisor',
        '-wealth',
        '-RIA',
        '-"financial planning"',
        '-"private banking"',
        '-"investment advisory"',
        '-"wealth management"',
        '-"financial consultant"',
        '-"fiduciary"',
        '-"portfolio management services"'
    ];
    
    const allExclusions = [...defaultExclusions, ...exclusions];
    const exclusionStr = allExclusions.join(' ');
    
    let query = basePattern;
    if (geography) {
        query += ` ${geography}`;
    }
    query += ` ${exclusionStr}`;
    
    return query.trim();
}

/**
 * Generate a set of recommended queries for an FO discovery run
 * Uses variety to find different types of family offices
 */
export function generateFOQuerySet(geography = 'Canada') {
    const queries = [];
    
    // Add direct terms
    queries.push(buildFamilyOfficeQuery('single family office', geography));
    queries.push(buildFamilyOfficeQuery('multi family office', geography));
    queries.push(buildFamilyOfficeQuery('"family office" capital', geography));
    
    // Add sleeper terms (highest quality results)
    queries.push(buildFamilyOfficeQuery('"private investment office"', geography));
    queries.push(buildFamilyOfficeQuery('"investment office" principal', geography));
    queries.push(buildFamilyOfficeQuery('"principal investments"', geography));
    
    // Add holdings patterns
    queries.push(buildFamilyOfficeQuery('holding company "private investments"', geography));
    queries.push(buildFamilyOfficeQuery('"family holdings" real estate', geography));
    
    // Add alternative structures
    queries.push(buildFamilyOfficeQuery('family-controlled capital', geography));
    queries.push(buildFamilyOfficeQuery('proprietor-owned investment', geography));
    
    return queries;
}

/**
 * Deep dive queries - for secondary research on discovered entities
 */
export const FAMILY_OFFICE_DEEP_RESEARCH = {
    // Profile verification queries
    profileVerification: [
        '{company} "private investments"',
        '{company} "portfolio" real estate',
        '{company} "direct investment"',
        '{company} family office',
    ],
    
    // Founder/family name research
    founderResearch: [
        '{founder_name} investment office',
        '{founder_name} capital',
        '{founder_name} holdings real estate',
    ],
    
    // Competitive analysis (who does this FO invest alongside?)
    competitiveAnalysis: [
        'family office investments real estate {geographic_focus}',
        'multi-family office portfolio {sector}',
    ]
};

/**
 * Exclusion patterns to keep out of FO discovery
 * These should be applied to EVERY FO query
 */
export const FO_EXCLUSION_PATTERNS = [
    '-advisor',
    '-wealth',
    '-RIA',
    '-"financial planning"',
    '-"private banking"',
    '-"investment advisory"',
    '-"wealth management"',
    '-"financial consultant"',
    '-fiduciary',
    '-"portfolio management services"',
    '-"mutual fund"',
    '-"ETF"',
    '-"registered fund"',
    '-consulting',
    '-agency'
];

/**
 * Quality checks to apply to discovered results
 * URL patterns that indicate legit FO vs noise
 */
export const FO_QUALITY_CHECKS = {
    positive: [
        /portfolio|investment|holdings|capital|office/i,
        /real.?estate|property|development|acquisitions/i,
        /principal|proprietary|company.?owned|private/i,
    ],
    negative: [
        /agent|realtor|broker|service/i,
        /consultant|advisor|planning/i,
        /directory|listings|registry/i,
        /news|blog|article/i,
    ]
};

/**
 * Generate report on query performance
 */
export function evaluateQueryPerformance(results, categoryName = '') {
    return {
        category: categoryName,
        total_results: results.length,
        high_quality_count: results.filter(r => r.quality_score >= 0.7).length,
        avg_quality: results.reduce((sum, r) => sum + (r.quality_score || 0), 0) / results.length,
        unique_entities: new Set(results.map(r => r.domain)).size
    };
}

export default {
    FAMILY_OFFICE_QUERY_PATTERNS,
    buildFamilyOfficeQuery,
    generateFOQuerySet,
    FAMILY_OFFICE_DEEP_RESEARCH,
    FO_EXCLUSION_PATTERNS,
    FO_QUALITY_CHECKS,
    evaluateQueryPerformance
};
