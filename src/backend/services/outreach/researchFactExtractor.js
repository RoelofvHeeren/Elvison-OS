/**
 * Research Fact Extractor V5.1
 * 
 * Deterministic extraction of research facts from company profiles.
 * No reliance on LLM decision-making for fact selection.
 * 
 * Priority order:
 * 1. Named deals/projects/assets (specific proper nouns)
 * 2. Scale facts (unit counts, portfolio size)
 * 3. Thesis line extraction (strategy/focus statements)
 * 4. General focus fallback
 * 
 * If nothing usable found: return null -> triggers NEEDS_RESEARCH
 */

export class ResearchFactExtractor {
    /**
     * List of placeholder keywords to filter out fake deals
     */
    static PLACEHOLDER_KEYWORDS = [
        '123 main', '123 main street', '456 oak', 'example ave', 'example avenue',
        'tbd', 'project x', 'project y', 'project name', '[project]', '[deal]',
        'fake', 'placeholder', 'sample', 'demo', 'test', '***', 'redacted'
    ];

    /**
     * Ticket 2: Terms that indicate company names, not deal names
     */
    static INVALID_DEAL_TERMS = [
        'capital', 'partners', 'management', 'investments', 'asset management',
        'corporation', 'company', 'group', 'holdings', 'advisors', 'advisory',
        'realtors', 'realty', 'brokerage', 'properties', 'ventures', 'equity',
        'fund', 'funds', 'trust', 'llc', 'inc', 'ltd', 'limited', 'corp'
    ];

    /**
     * Property type/project keywords to identify named deals
     */
    static PROPERTY_KEYWORDS = [
        'condos', 'condo', 'residences', 'residence', 'apartments', 'apartment',
        'centre', 'center', 'tower', 'towers', 'village', 'villages',
        'lofts', 'loft', 'development', 'developments', 'project',
        'estate', 'estates', 'complex', 'complexes', 'complex',
        'community', 'communities', 'residential', 'residential complex',
        'mixed use', 'mixed-use', 'urban residential'
    ];

    /**
     * Scale detection keywords
     */
    static SCALE_KEYWORDS = [
        'units', 'unit', 'properties', 'property', 'buildings', 'building',
        'homes', 'home', 'suites', 'suite', 'bedrooms', 'bed',
        'square feet', 'sq ft', 'sqft', 'acres', 'acre'
    ];

    /**
     * Thesis/strategy keywords for identifying investment philosophy
     */
    static THESIS_KEYWORDS = [
        'focuses on', 'focus on', 'focused on',
        'invests in', 'invest in', 'investing in',
        'strategy', 'strategic', 'strategies',
        'thesis', 'approach',
        'target', 'targets',
        'specializes in', 'specialise in', 'specialty',
        'expertise in', 'expert in',
        'platform for', 'platforms for',
        'enable', 'enables'
    ];

    /**
     * Main extraction method
     * 
     * @param {string} profileText - The company profile text
     * @param {string} companyName - The company name
     * @param {string} icpType - The ICP type (FamilyOffice, InvestmentFirm, etc)
     * @returns {Object} { fact, fact_type, confidence, reason }
     */
    static extract(profileText, companyName = '', icpType = '') {
        try {
            if (!profileText || profileText.trim().length === 0) {
                return this._noResult('Empty profile provided');
            }

            // Clean markdown headers before processing
            const profile = profileText.replace(/^#+\s+.*$/gm, '').trim();
            const profileLower = profile.toLowerCase();

            // === Priority 1: Named Deals/Projects ===
            const namedDeal = this._extractNamedDeal(profile, profileLower);
            if (namedDeal) {
                return namedDeal;
            }

            // === Priority 2: Scale Facts ===
            // Specific numbers ("178 units") are highly credible
            const scale = this._extractScale(profile, profileLower);
            if (scale) {
                return scale;
            }

            // === Priority 3: Thesis/Strategy Lines ===
            const thesis = this._extractThesis(profile, profileLower, companyName);
            if (thesis) {
                return thesis;
            }

            // === Priority 4: General Focus ===
            const general = this._extractGeneralFocus(profile, profileLower, companyName);
            if (general) {
                return general;
            }

            // === No usable fact found ===
            return this._noResult('No usable research fact found in profile');

        } catch (error) {
            console.error('[ResearchFactExtractor] Extraction error:', error);
            // Graceful degradation: return NEEDS_RESEARCH instead of crashing
            return this._noResult(`Extraction error: ${error.message}`);
        }
    }

    /**
     * Priority 1: Extract named deal/project/asset
     * Looks for proper nouns followed by property keywords
     * Supports "The X at Y" and "X in City" formats
     */
    static _extractNamedDeal(profile, profileLower) {
        const patterns = [
            // 1. "Named [PropertyType]" format (e.g. "Alpine Village", "Skyline Tower")
            // Enforce strict capitalization [A-Z]
            /([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*\s+(?:Condos?|Residences?|Apartments?|Centre|Center|Towers?|Villages?|Lofts?|Developments?|Estates?|Complex(?:es)?|Communit(?:y|ies)|Plaza|Square|Gardens?|Park|Resort|Hotel))/g,

            // 2. "The [Name] at [Location]" format
            /(?:The|the)?\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)\s+(?:at|in|on)\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)/g,

            // 3. "The [Name] [PropertyType]" (e.g. "The Oakley Apartments")
            /(?:The|the)\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*\s+(?:Condos?|Residences?|Apartments?|Centre|Center|Towers?|Villages?|Lofts?|Developments?|Estates?|Complex(?:es)?|Communit(?:y|ies)))/g
        ];

        for (const pattern of patterns) {
            const matches = profile.matchAll(pattern);
            for (const match of matches) {
                let dealName = match[1].trim();

                // For pattern 2 ("The X at Y"), construct the full name
                if (match.length > 2 && match[2]) {
                    // Check if the second part is a location or continuation
                    dealName = `${match[1]} at ${match[2]}`;
                }
                // Capture strict "The X Y" for pattern 3
                else if (match[0].toLowerCase().startsWith('the ')) {
                    dealName = match[1]; // match[1] checks inner group
                }

                // Reject placeholder names
                if (this._isPlaceholder(dealName)) {
                    continue;
                }

                // Reject company names masquerading as deals
                if (this._looksLikeCompanyNameNotDeal(dealName)) {
                    continue;
                }

                // Verify length and specificity
                if (dealName.length > 5 && dealName.length < 100 && !this._isTooGeneric(dealName)) {
                    // Trim to reasonable length if it captured a long location string
                    const trimmedFact = this._trimFact(dealName, 60);
                    return {
                        fact: trimmedFact,
                        fact_type: 'DEAL',
                        confidence: 0.95,
                        reason: 'Named deal/project detected'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Priority 2: Extract scale facts
     * Looks for numbers followed by scale keywords
     * Validates that numbers are realistic
     */
    static _extractScale(profile, profileLower) {
        // Match number + scale keyword pattern
        // Allows 1-2 words between number and unit (e.g. "5,000 multifamily units")
        const patterns = [
            /([0-9,]+(?:\.[0-9]+)?)\s*(?:\+|plus|over|approximately|~)\s*(?:[a-zA-Z-]+\s+){0,2}(units|unit|properties|property|buildings|building|homes|home|suites|suite)/gi,
            /([0-9,]+(?:\.[0-9]+)?)\s*(?:[a-zA-Z-]+\s+){0,2}(units|unit|properties|property|buildings|building|homes|home|suites|suite|bedrooms|beds|apartments|apartment|condos|condo)/gi,
            // Capture Portfolio Value if specific: "$X billion portfolio"
            /(\$[0-9,]+(?:\.[0-9]+)?\s*(?:million|billion|M|B))\s+(?:portfolio|assets|value|development pipeline)/gi
        ];

        for (const pattern of patterns) {
            const match = profile.match(pattern);
            if (match) {
                const scaleFact = match[0].trim();

                // Check for banned phrases (AUM is banned to avoid generic wealth managers)
                if (this._hasBannedPhrase(scaleFact)) {
                    continue;
                }

                // Validate Number Logic
                const cleanNumberStr = scaleFact.replace(/,/g, '');
                const numbers = cleanNumberStr.match(/\d+/g);

                if (numbers) {
                    const maxNum = Math.max(...numbers.map(n => parseInt(n)));

                    // Reject small numbers (likely just "2 phases" or "1 building")
                    // Reject impossible numbers (likely zip codes or years 2023)
                    if (maxNum > 50 && maxNum < 500000 && maxNum !== 2020 && maxNum !== 2021 && maxNum !== 2022 && maxNum !== 2023 && maxNum !== 2024 && maxNum !== 2025) {
                        const trimmedFact = this._trimFact(scaleFact, 70);
                        return {
                            fact: trimmedFact,
                            fact_type: 'SCALE',
                            confidence: 0.90,
                            reason: 'Portfolio scale fact detected'
                        };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Priority 3: Extract thesis/strategy statement
     * Looks for sentences containing strategy keywords
     * Improved boundary detection
     */
    static _extractThesis(profile, profileLower, companyName) {
        // Split into sentences using a smarter regex that handles common abbreviations
        const sentences = profile.match(/[^.!?]+[.!?]+/g) || [];

        for (const sentence of sentences) {
            const sentenceLower = sentence.toLowerCase();

            // Check keywords
            if (!this.THESIS_KEYWORDS.some(kw => sentenceLower.includes(kw))) {
                continue;
            }

            // Extract and clean
            let fact = sentence
                .trim()
                .replace(/^[A-Z][a-z]+:\s*/, '') // Remove "Caption: "
                .replace(/^-\s*/, '') // Remove bullet
                .replace(/\r?\n|\r/g, ' '); // Remove newlines

            // Reject if generic or banned
            if (this._isTooGeneric(fact) || this._hasBannedPhrase(fact)) {
                continue;
            }

            // Trim smart
            const trimmedFact = this._trimFact(fact, 140, companyName);
            return {
                fact: trimmedFact.trim(),
                fact_type: 'THESIS',
                confidence: 0.85,
                reason: 'Strategy/thesis statement extracted'
            };
        }

        return null;
    }

    /**
     * Priority 4: Extract general focus
     */
    static _extractGeneralFocus(profile, profileLower, companyName) {
        const focusPatterns = [
            /focuses? on\s+([a-z\s,]+?)(?:\.|,|;|and)/gi,
            /specializes? in\s+([a-z\s,]+?)(?:\.|,|;|and)/gi,
            /expertise in\s+([a-z\s,]+?)(?:\.|,|;|and)/gi
        ];

        for (const pattern of focusPatterns) {
            const match = profile.match(pattern);
            if (match) {
                let focus = match[0]
                    .replace(/focuses? on\s*/i, '')
                    .replace(/specializes? in\s*/i, '')
                    .replace(/expertise in\s*/i, '')
                    .replace(/[.;,\s]+$/, '')
                    .trim();

                if (focus.length > 10 && focus.length < 200 && !this._isTooGeneric(focus)) {
                    const trimmedFact = this._trimFact(focus, 110);
                    return {
                        fact: trimmedFact,
                        fact_type: 'GENERAL',
                        confidence: 0.75,
                        reason: 'General focus statement extracted'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Smart fact trimming that preserves meaning
     */
    static _trimFact(fact, maxLen = 140, companyName = '') {
        if (!fact) return fact;
        let s = fact.trim();

        // Remove leading punctuation/whitespace
        s = s.replace(/^[,:;.\s]+/, '');

        // Convert first-person pronouns to Company Name or "They"
        if (companyName) {
            const cleanCompany = companyName.replace(/^The\s+/i, '');
            // Only replace at start of string to avoid mid-sentence grammar errors
            s = s.replace(/^We\s+/i, `${cleanCompany} `)
                .replace(/^Our\s+/i, `${cleanCompany}'s `);
        } else {
            s = s.replace(/^We\s+/i, 'They ')
                .replace(/^Our\s+/i, 'Their ');
        }

        // Remove "is a company that" fluff
        s = s.replace(/^(is|are)\s+(a|an)\s+(company|firm|developer|investor)\s+(that|which)\s+/i, '');

        if (s.length <= maxLen) {
            return s.replace(/[,:;.\s]+$/g, '');
        }

        // CUTTING LOGIC:
        let clipped = s.slice(0, maxLen);

        // Try to cut at the last sentence boundary
        const lastPeriod = clipped.lastIndexOf('.');
        if (lastPeriod > maxLen * 0.5) {
            return clipped.slice(0, lastPeriod).replace(/[,:;.\s]+$/g, '');
        }

        // Try to cut at the last semi-colon or em-dash (new in V5.1)
        const lastPunct = Math.max(clipped.lastIndexOf(';'), clipped.lastIndexOf('—'), clipped.lastIndexOf(':'));
        if (lastPunct > maxLen * 0.4) {
            return clipped.slice(0, lastPunct).replace(/[,:;.\s]+$/g, '');
        }

        // Try to cut at the last comma
        const lastComma = clipped.lastIndexOf(',');
        if (lastComma > maxLen * 0.6) {
            return clipped.slice(0, lastComma).replace(/[,:;.\s]+$/g, '');
        }

        // Fallback: Cut at last word boundary
        return clipped.replace(/\s+\S*$/, '').replace(/[,:;.\s]+$/g, '');
    }

    /**
     * Check if a string is a placeholder
     */
    static _isPlaceholder(text) {
        const lower = text.toLowerCase();
        return this.PLACEHOLDER_KEYWORDS.some(ph => lower.includes(ph));
    }

    /**
     * Check if text looks like a company name, not a deal name
     */
    static _looksLikeCompanyNameNotDeal(text) {
        const lower = text.toLowerCase();
        return this.INVALID_DEAL_TERMS.some(term => lower.includes(term));
    }

    /**
     * Check if a string is too generic or lacks substance
     */
    static _isTooGeneric(text) {
        const genericTerms = [
            'alternative investments', 'global reach', 'years in business',
            'impressed', 'synergies', 'group',
            'market leader', 'proven track record', 'highest standards'
        ];

        const lower = text.toLowerCase();
        const matchCount = genericTerms.filter(term => lower.includes(term)).length;
        if (matchCount > 1) return true;
        if (lower.length <= 5) return true;

        return false;
    }

    /**
     * Check for banned phrases that should disqualify a fact
     */
    static _hasBannedPhrase(text) {
        const bannedPhrases = [
            'AUM', 'assets under management', 'assets moved',
            'global reach', 'number of offices', 'years in business',
            'awards', 'transaction volume', 'employee count',
            'founded in', 'since 19', 'since 20'
        ];

        const lower = text.toLowerCase();
        return bannedPhrases.some(phrase => lower.includes(phrase.toLowerCase()));
    }

    /**
     * Return null result with reason
     */
    static _noResult(reason) {
        return {
            fact: null,
            fact_type: null,
            confidence: 0,
            reason: reason
        };
    }
}

export default ResearchFactExtractor;
