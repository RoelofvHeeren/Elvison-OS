/**
 * Deep Cleanup v2 - Investor Database Cleanup
 * 
 * This script implements the comprehensive cleanup spec for transforming
 * scraped company data into a high-quality investor CRM.
 */

// ============================================================================
// COMPANY ACTION MAP - Hardcoded decisions for all known companies
// ============================================================================

export const COMPANY_ACTIONS = {
    // === KEEP - Asset Managers Multi-Strategy ===
    'Northleaf Capital Partners': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', capital_role: 'FUND_MANAGER', canada_relevance: 'CANADA_ACTIVE' },
    'Lone Star Funds': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', capital_role: 'FUND_MANAGER' },
    'Sagard Real Estate': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', capital_role: 'FUND_MANAGER' },
    'Apollo Global Management': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', capital_role: 'FUND_MANAGER' },
    'L Catterton': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', notes: 'PE platform, not RE specific' },
    'Alaris Equity Partners': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'StepStone Group': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Blue Owl Capital': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Oaktree Capital Management': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'SLC Management': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Fortress Investment Group': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Partners Group': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Principal Asset Management': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Schroders': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Invesco Ltd': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Invesco': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'BlackRock': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Blackstone': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'The Carlyle Group': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Fiera Capital': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Ares Management Corporation': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Adams Street Partners': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Wealhouse Capital Management': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'TPG': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'EQT Group': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'KKR': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Bain Capital': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Aviva Investors': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Grosvenor': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },

    // === KEEP - Real Estate Private Equity ===
    'PATRIZIA SE': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY', capital_role: 'FUND_MANAGER' },
    'Spira Equity Partners': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Hazelview Investments': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Forum Asset Management': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Greybrook Realty Partners': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'LaSalle Investment Management': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Hines': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'CIM Group': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Fengate Asset Management': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Centurion Asset Management Inc': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'BGO': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Equiton Inc': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Harrison Street': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Clarion Partners LLC': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'PIMCO Prime Real Estate': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Tricor Pacific Capital Inc': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'CBRE Investment Management': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Terracap Management Inc': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Skyline Group of Companies': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'KingSett Capital': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'GWL Realty Advisors': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Firm Capital Organization': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Harlo Capital': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Lankin Investments': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Unico Properties LLC': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Performing Equity Ltd': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'KV Capital': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },
    'Avenue Living': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY' },

    // === KEEP - REITs ===
    'H&R REIT': { status: 'KEEP', icp_type: 'REIT_PUBLIC', capital_role: 'DIRECT_EQUITY' },
    'RioCan Real Estate Investment Trust': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Killam Apartment REIT': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Minto Apartment REIT': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Boardwalk': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Morguard': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Artis REIT': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Cominar': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'CAPREIT': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },
    'Prologis': { status: 'KEEP', icp_type: 'REIT_PUBLIC' },

    // === KEEP - RE Developer/Operator ===
    'Brookfield Properties': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR', parent: 'Brookfield' },
    'Alpine Start Development': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR', capital_role: 'DIRECT_EQUITY' },
    'Osmington Inc': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Trammell Crow Residential': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR', parent: 'Crow Holdings' },
    'Crow Holdings': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Fitzrovia': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Related Management Company': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Dream': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Minto Group': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Beedie': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Wall Financial Corporation': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Thor Equities Group': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Baz Group of Companies': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Westbank Corp': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Triovest': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Avenue Living Communities': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'EM Real Estate': { status: 'KEEP', icp_type: 'RE_DEVELOPER_OPERATOR' },

    // === KEEP - Pension Funds ===
    'HOOPP': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },
    'Ontario Teachers Pension Plan': { status: 'KEEP', icp_type: 'PENSION' },
    'Alberta Investment Management Corporation': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },
    'AIMCo': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },
    'QuadReal Property Group': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },
    'Oxford Properties Group': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },
    'CPP Investments': { status: 'KEEP', icp_type: 'PENSION' },
    'BCI': { status: 'KEEP', icp_type: 'PENSION' },
    'PSP Investments': { status: 'KEEP', icp_type: 'PENSION' },
    'Cadillac Fairview': { status: 'KEEP', icp_type: 'PENSION', capital_role: 'DIRECT_EQUITY' },

    // === KEEP - Sovereign Wealth Fund ===
    'Mubadala': { status: 'KEEP', icp_type: 'SOVEREIGN_WEALTH_FUND' },

    // === KEEP - Insurance Investor ===
    'Canada Life': { status: 'KEEP', icp_type: 'INSURANCE_INVESTOR' },
    'MetLife Investment Management': { status: 'KEEP', icp_type: 'INSURANCE_INVESTOR' },
    'Manulife Investment Management': { status: 'KEEP', icp_type: 'INSURANCE_INVESTOR' },

    // === KEEP - Real Estate Debt Fund ===
    'Trez Capital': { status: 'KEEP', icp_type: 'REAL_ESTATE_DEBT_FUND', capital_role: 'DIRECT_DEBT' },
    'Timbercreek': { status: 'KEEP', icp_type: 'REAL_ESTATE_DEBT_FUND' },
    'Cameron Stephens': { status: 'KEEP', icp_type: 'REAL_ESTATE_DEBT_FUND' },
    'CMLS Financial': { status: 'KEEP', icp_type: 'REAL_ESTATE_DEBT_FUND' },

    // === KEEP - Bank Lender ===
    'Credit Agricole CIB': { status: 'KEEP', icp_type: 'BANK_LENDER', capital_role: 'DIRECT_DEBT' },

    // === KEEP - Family Office ===
    'Richter': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_MULTI' },
    'Tacita Capital Inc': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_MULTI' },
    'Thomvest': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_SINGLE' },
    'Northwood Family Office': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_MULTI' },
    'Claridge Inc': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_SINGLE' },
    'White Owl Family Office Group': { status: 'KEEP', icp_type: 'FAMILY_OFFICE_MULTI' },

    // === KEEP - Platform/Fractional ===
    'Fundrise': { status: 'KEEP', icp_type: 'PLATFORM_FRACTIONAL' },
    'Parvis': { status: 'KEEP', icp_type: 'PLATFORM_FRACTIONAL' },
    'addy': { status: 'KEEP', icp_type: 'PLATFORM_FRACTIONAL' },

    // === KEEP - Other with reclassification ===
    'Brookfield': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', notes: 'Canonical parent' },
    'CBRE': { status: 'KEEP', icp_type: 'REAL_ESTATE_PRIVATE_EQUITY', notes: 'Split from advisory' },
    'Nicola Institutional Realty Advisors': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', capital_role: 'FUND_MANAGER' },
    'Decarbonization Partners': { status: 'KEEP', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', parent: 'BlackRock' },

    // === DELETE - Service Providers ===
    'Knight Frank': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['BROKER_SERVICE_PROVIDER'] },
    'Interests': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['NAME_TOO_GENERIC'] },
    'Syndicate Lending Corporation': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['BROKER_SERVICE_PROVIDER'] },
    'ATB Financial': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'Private Pension Partners': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'The Team': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['BROKER_SERVICE_PROVIDER'] },
    'Private Real Estate Investments': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'ABC PROPERTY SOLUTIONS INC': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['DOMAIN_MISMATCH', 'WRONG_ENTITY'] },
    'dakota': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', notes: 'data marketplace' },
    'FPI Management': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'Pivot Real Estate Group': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'Citrin Cooperman': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'TMX Group': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'Marcus & Millichap': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER' },
    'RBC Capital Markets': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', notes: 'advisory, underwriting' },
    'KAF': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WRONG_ENTITY'] },
    'CBRE Global Workplace Solutions': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['BROKER_SERVICE_PROVIDER'] },

    // === DELETE - Wealth Managers ===
    'HollisWealth': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'iA Private Wealth': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'Raymond James Ltd': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'RBC Wealth Management': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'MRG Wealth': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'PWL Capital Inc': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'IG Gestion de patrimoine': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'IG Wealth Management': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'Odlum Brown Limited': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'Harbourfront Wealth Management': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'Canaccord Genuity Wealth Management Canada': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'ATB Wealth': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    '3Macs, a division of Raymond James': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },
    'Highgate Group Inc': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['WEALTH_MANAGER'] },

    // === DELETE - Tech Vendors ===
    'BLACK SEA CONSULTING': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['TECH_VENDOR'] },
    'Salesforce': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['TECH_VENDOR'] },
    'Snowflake': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['TECH_VENDOR'] },
    'Elvison Foundations': { status: 'DELETE', icp_type: 'SERVICE_PROVIDER', flags: ['TECH_VENDOR'], notes: 'not investor' },

    // === DELETE - Data Errors ===
    'Unknown': { status: 'DELETE', icp_type: 'DATA_ERROR_UNKNOWN', flags: ['UNKNOWN_ENTITY'] },

    // === MERGE - Duplicates/Subsidiaries ===
    'Bentall Kennedy': { status: 'MERGE', merge_into: 'BGO', flags: ['DUPLICATE'] },
    'Stealth Investment Company': { status: 'MERGE', merge_into: 'Claridge Inc', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'B C Investment Group': { status: 'MERGE', merge_into: 'BCI', flags: ['DUPLICATE'] },
    'Invesco EMEA': { status: 'MERGE', merge_into: 'Invesco Ltd', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'Brookfield Asset Management - Asia Pacific': { status: 'MERGE', merge_into: 'Brookfield', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'BMO U.S': { status: 'MERGE', merge_into: 'BMO', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'OppenheimerFunds': { status: 'MERGE', merge_into: 'Invesco', flags: ['DUPLICATE'] },
    'Dream Advisors': { status: 'MERGE', merge_into: 'Dream', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'BMO Private Wealth': { status: 'MERGE', merge_into: 'BMO', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'Manulife Investment Management, Timberland and Agriculture': { status: 'MERGE', merge_into: 'Manulife Investment Management', flags: ['SUBSIDIARY'] },
    'CBRE Investment Management (Netherlands)': { status: 'MERGE', merge_into: 'CBRE Investment Management', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'CBRE Asia Pacific': { status: 'MERGE', merge_into: 'CBRE', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'Manulife Investment Management, Canada': { status: 'MERGE', merge_into: 'Manulife Investment Management', flags: ['SUBSIDIARY'] },
    'Bank of the West': { status: 'MERGE', merge_into: 'BMO', flags: ['SUBSIDIARY'] },
    'Pg Partners Ltd': { status: 'MERGE', merge_into: 'Partners Group', flags: ['DUPLICATE'] },
    'Sagard Holdings': { status: 'MERGE', merge_into: 'Sagard Real Estate', flags: ['DUPLICATE'] },
    'Guardian Partners Inc': { status: 'MERGE', merge_into: 'Guardian Capital Group', flags: ['DUPLICATE'] },
    'Fiera Capital Inc.': { status: 'MERGE', merge_into: 'Fiera Capital', flags: ['DUPLICATE'] },
    'Invesco US': { status: 'MERGE', merge_into: 'Invesco', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'Invesco Asia Pacific': { status: 'MERGE', merge_into: 'Invesco', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'Minto Management Limited': { status: 'MERGE', merge_into: 'Minto Group', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'BMO Nesbitt Burns': { status: 'MERGE', merge_into: 'BMO', flags: ['DUPLICATE', 'SUBSIDIARY'] },
    'BMO Global Asset Management': { status: 'MERGE', merge_into: 'BMO', flags: ['DUPLICATE'] },

    // === REVIEW_REQUIRED ===
    'PROSPECTIVE VALUE PARTNERS LLC': { status: 'REVIEW_REQUIRED', flags: ['DOMAIN_MISMATCH', 'WRONG_ENTITY'], notes: 'goldmansachs.com domain - rename or delete' },
    'OEG Inc': { status: 'REVIEW_REQUIRED', icp_type: 'DATA_ERROR_UNKNOWN', notes: 'unclear investor mandate' },
    'BMO': { status: 'REVIEW_REQUIRED', icp_type: 'BANK_LENDER', notes: 'verify target division' },
    'UBS': { status: 'REVIEW_REQUIRED', icp_type: 'BANK_LENDER', notes: 'wealth management heavy' },
    'Abu Dhabi National Chemicals Company': { status: 'REVIEW_REQUIRED', flags: ['DOMAIN_MISMATCH'], notes: 'mubadala.com domain' },
    'Duke Realty Corporation': { status: 'REVIEW_REQUIRED', notes: 'now Prologis owned' },
    'Fidelity Canada': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', notes: 'mostly public funds' },
    'RBC Global Asset Management': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Starlight Capital': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'Spotlight Development Inc': { status: 'REVIEW_REQUIRED', icp_type: 'RE_DEVELOPER_OPERATOR' },
    'Montrusco Bolton Investments Inc': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', notes: 'mostly public equities' },
    'Stealth Mode': { status: 'REVIEW_REQUIRED', flags: ['NAME_TOO_GENERIC'], notes: 'normalize or delete' },
    'Knowledge Bridge Inc': { status: 'REVIEW_REQUIRED', flags: ['DOMAIN_MISMATCH'], notes: 'carlyle.com domain' },
    'Cantor Fitzgerald Europe': { status: 'REVIEW_REQUIRED', icp_type: 'BANK_LENDER' },
    'GEM': { status: 'REVIEW_REQUIRED', flags: ['NAME_TOO_GENERIC'] },
    'Viewpoint Investment Partners': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY' },
    'McConnell Foundation': { status: 'REVIEW_REQUIRED', icp_type: 'FAMILY_OFFICE_SINGLE', notes: 'impact investor' },
    'North Star Consulting, LLC': { status: 'DELETE', flags: ['WRONG_ENTITY', 'DOMAIN_MISMATCH'], notes: 'canadalife.com domain' },
    'Guardian Capital': { status: 'REVIEW_REQUIRED', flags: ['DUPLICATE'], notes: 'verify correct domain' },
    'Cardinal Capital Management, Inc': { status: 'REVIEW_REQUIRED', icp_type: 'ASSET_MANAGER_MULTI_STRATEGY', notes: 'public markets' },
    'Horizon studio': { status: 'DELETE', flags: ['NAME_TOO_GENERIC', 'WRONG_ENTITY'] },
};

// ============================================================================
// NORMALIZATION FUNCTIONS
// ============================================================================

/**
 * Clean company name by removing common suffixes
 */
export function cleanCompanyName(name) {
    if (!name) return '';
    const suffixes = [
        'Inc\\.?', 'Incorporated', 'Ltd\\.?', 'Limited', 'LLC', 'L\\.?P\\.?', 'LP',
        'SE', 'Group', 'Corporation', 'Corp\\.?', 'Holdings', 'Partners', 'PLC',
        'S\\.A\\.?', 'N\\.V\\.?', 'GmbH', 'AG', 'Co\\.?'
    ];
    let clean = name.trim();
    for (const suffix of suffixes) {
        clean = clean.replace(new RegExp(`,?\\s*${suffix}$`, 'gi'), '');
    }
    // Also normalize whitespace
    clean = clean.replace(/\s+/g, ' ').trim();
    return clean;
}

/**
 * Extract root domain from URL
 */
export function extractRootDomain(url) {
    if (!url) return '';
    try {
        // Add protocol if missing
        if (!url.startsWith('http')) {
            url = 'https://' + url;
        }
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        // Try to extract domain from malformed URL
        const match = url.match(/(?:https?:\/\/)?(?:www\.)?([^\/\s]+)/i);
        return match ? match[1].toLowerCase() : '';
    }
}

/**
 * Check if domain matches company name (detect mismatches)
 */
export function checkDomainMatch(companyName, domain) {
    if (!companyName || !domain) return { match: false, score: 0 };

    const nameTokens = cleanCompanyName(companyName)
        .toLowerCase()
        .split(/[\s\-\_\.]+/)
        .filter(t => t.length > 2);

    const domainBase = domain.replace(/\.(com|ca|org|net|io|co|ag)$/i, '');
    const domainTokens = domainBase.split(/[\-\_\.]+/).filter(t => t.length > 2);

    // Check for any matching tokens
    const matchingTokens = nameTokens.filter(t =>
        domainTokens.some(d => d.includes(t) || t.includes(d))
    );

    const score = matchingTokens.length / Math.max(nameTokens.length, 1);

    return {
        match: score > 0.3,
        score,
        nameTokens,
        domainTokens,
        matchingTokens
    };
}

// ============================================================================
// FIT SCORE ENGINE
// ============================================================================

/**
 * Calculate fit score with breakdown (0-10)
 */
export function calculateFitScore(company) {
    const breakdown = {
        investor_type_relevance: 0,    // 0-2
        real_estate_focus: 0,          // 0-2
        direct_capital_deployment: 0,  // 0-2
        canada_focus: 0,               // 0-2
        deal_fit: 0                    // 0-2
    };

    const icpType = company.icp_type || '';
    const capitalRole = company.capital_role || '';
    const canadaRelevance = company.canada_relevance || '';

    // Investor Type Relevance (0-2)
    const highValueTypes = ['PENSION', 'SOVEREIGN_WEALTH_FUND', 'REAL_ESTATE_PRIVATE_EQUITY', 'FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI'];
    const mediumValueTypes = ['ASSET_MANAGER_MULTI_STRATEGY', 'INSURANCE_INVESTOR', 'RE_DEVELOPER_OPERATOR', 'REIT_PUBLIC'];
    const lowValueTypes = ['BANK_LENDER', 'REAL_ESTATE_DEBT_FUND', 'PLATFORM_FRACTIONAL'];

    if (highValueTypes.includes(icpType)) breakdown.investor_type_relevance = 2;
    else if (mediumValueTypes.includes(icpType)) breakdown.investor_type_relevance = 1.5;
    else if (lowValueTypes.includes(icpType)) breakdown.investor_type_relevance = 1;

    // Real Estate Focus (0-2)
    const reFocusedTypes = ['REAL_ESTATE_PRIVATE_EQUITY', 'RE_DEVELOPER_OPERATOR', 'REIT_PUBLIC', 'REAL_ESTATE_DEBT_FUND'];
    if (reFocusedTypes.includes(icpType)) breakdown.real_estate_focus = 2;
    else if (['ASSET_MANAGER_MULTI_STRATEGY', 'PENSION'].includes(icpType)) breakdown.real_estate_focus = 1.5;
    else if (['FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI'].includes(icpType)) breakdown.real_estate_focus = 1;

    // Direct Capital Deployment (0-2)
    if (['DIRECT_EQUITY', 'DIRECT_DEBT'].includes(capitalRole)) breakdown.direct_capital_deployment = 2;
    else if (capitalRole === 'FUND_MANAGER') breakdown.direct_capital_deployment = 1.5;
    else if (capitalRole === 'LP_ALLOCATOR_ONLY') breakdown.direct_capital_deployment = 1;

    // Canada Focus (0-2)
    if (canadaRelevance === 'CANADA_HEADQUARTERED') breakdown.canada_focus = 2;
    else if (canadaRelevance === 'CANADA_ACTIVE') breakdown.canada_focus = 1.5;
    else if (canadaRelevance === 'UNKNOWN') breakdown.canada_focus = 0.5;

    // Deal Fit - residential development (0-2)
    // Based on known deal types for this ICP
    if (['RE_DEVELOPER_OPERATOR', 'REAL_ESTATE_PRIVATE_EQUITY'].includes(icpType)) breakdown.deal_fit = 2;
    else if (['REAL_ESTATE_DEBT_FUND', 'PENSION'].includes(icpType)) breakdown.deal_fit = 1.5;
    else if (['FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI', 'ASSET_MANAGER_MULTI_STRATEGY'].includes(icpType)) breakdown.deal_fit = 1;

    // Calculate total (clamp to 0-10)
    const total = Math.min(10, Math.max(0, Math.round(
        breakdown.investor_type_relevance +
        breakdown.real_estate_focus +
        breakdown.direct_capital_deployment +
        breakdown.canada_focus +
        breakdown.deal_fit
    )));

    return {
        fit_score: total,
        fit_score_breakdown: breakdown
    };
}

// ============================================================================
// LEAD CLEANUP RULES
// ============================================================================

const KEEP_TITLE_PATTERNS = [
    /investment/i,
    /private\s+markets/i,
    /real\s+assets/i,
    /real\s+estate/i,
    /portfolio\s+manager/i,
    /managing\s+director/i,
    /partner/i,
    /principal/i,
    /head\s+of/i,
    /acquisitions/i,
    /development/i,
    /capital/i,
    /director/i,
    /vp/i,
    /vice\s+president/i,
];

const DELETE_TITLE_PATTERNS = [
    /realtor/i,
    /agent/i,
    /\bbroker\b/i,
    /sales\s+rep/i,
    /customer\s+success/i,
    /marketing/i,
    /\bhr\b/i,
    /human\s+resources/i,
    /recruiter/i,
    /facilities/i,
    /wealth\s+advisor/i,
    /financial\s+planner/i,
    /advisor/i,
    /consultant/i,
    /intern/i,
    /student/i,
    /coordinator/i,
    /admin/i,
    /assistant/i,
];

export function shouldKeepLead(title) {
    if (!title) return false;

    // Check for delete patterns first
    for (const pattern of DELETE_TITLE_PATTERNS) {
        if (pattern.test(title)) return false;
    }

    // Check for keep patterns
    for (const pattern of KEEP_TITLE_PATTERNS) {
        if (pattern.test(title)) return true;
    }

    // Default: keep if no match (conservative)
    return true;
}

export function classifyLeadSeniority(title) {
    if (!title) return 'UNKNOWN';
    const t = title.toLowerCase();

    if (/partner|founding|co-founder|founder/i.test(t)) return 'PARTNER';
    if (/managing\s+director|md/i.test(t)) return 'MANAGING_DIRECTOR';
    if (/\bdirector\b/i.test(t)) return 'DIRECTOR';
    if (/\bvp\b|vice\s+president|svp|evp/i.test(t)) return 'VP';
    if (/associate/i.test(t)) return 'ASSOCIATE';
    if (/analyst/i.test(t)) return 'ANALYST';

    return 'UNKNOWN';
}

export function classifyLeadRoleGroup(title) {
    if (!title) return 'UNKNOWN';
    const t = title.toLowerCase();

    if (/investment|capital|private\s+markets|portfolio/i.test(t)) return 'INVESTMENTS';
    if (/real\s+estate|property|asset\s+management/i.test(t)) return 'REAL_ESTATE';
    if (/private\s+equity|pe\s|buyout|growth/i.test(t)) return 'PRIVATE_MARKETS';
    if (/corporate\s+finance|m&a|treasury/i.test(t)) return 'CORPORATE_FINANCE';
    if (/wealth|advisor|planning/i.test(t)) return 'WEALTH_ADVISOR';
    if (/sales|business\s+development|bd\s/i.test(t)) return 'SALES';

    return 'UNKNOWN';
}
