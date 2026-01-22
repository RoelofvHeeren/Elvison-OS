/**
 * Research Fact Extractor
 * 
 * Deterministic extraction of research facts from company profiles.
 * No reliance on LLM decision-making for fact selection.
 * 
 * Priority order:
 * 1. Named deals/projects/assets (specific proper nouns)
 * 2. Thesis line extraction (strategy/focus statements)
 * 3. Scale facts (unit counts, portfolio size)
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
        if (!profileText || profileText.trim().length === 0) {
            return this._noResult('Empty profile provided');
        }

        const profile = profileText.trim();
        const profileLower = profile.toLowerCase();

        // === Priority 1: Named Deals/Projects ===
        const namedDeal = this._extractNamedDeal(profile, profileLower);
        if (namedDeal) {
            return namedDeal;
        }

        // === Priority 2: Thesis/Strategy Lines ===
        const thesis = this._extractThesis(profile, profileLower);
        if (thesis) {
            return thesis;
        }

        // === Priority 3: Scale Facts ===
        const scale = this._extractScale(profile, profileLower);
        if (scale) {
            return scale;
        }

        // === Priority 4: General Focus ===
        const general = this._extractGeneralFocus(profile, profileLower, companyName);
        if (general) {
            return general;
        }

        // === No usable fact found ===
        return this._noResult('No usable research fact found in profile');
    }

    /**
     * Priority 1: Extract named deal/project/asset
     * Looks for proper nouns followed by property keywords
     * Example: "Alpine Village", "Fifth and Main Tower", "Riverside Apartments"
     */
    static _extractNamedDeal(profile, profileLower) {
        // Look for capitalized phrases (proper nouns) followed by property keywords
        const patterns = [
            // "Named [PropertyType]" format
            /([A-Z][a-zA-Z\s]{2,30})\s+(Condo|Condos|Residences|Residence|Apartments|Apartment|Centre|Center|Tower|Towers|Village|Villages|Lofts|Loft|Development|Developments|Estate|Estates|Complex|Complexes|Community|Communities)/gi,
            
            // "The [PropertyType] at [Named Location]" format
            /(?:the)?\s+([A-Z][a-zA-Z\s]{2,30})\s+(?:at|in|on|phase|parcel)\s+([A-Z][a-zA-Z\s]{2,30})/gi,
            
            // Simple capitalized phrases (proper nouns) - 2+ words
            /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:is|features?|includes?|contains?|consists?|development|project|property|asset)/gi
        ];

        for (const pattern of patterns) {
            const matches = profile.matchAll(pattern);
            for (const match of matches) {
                const dealName = match[1].trim();
                
                // Reject placeholder names
                if (this._isPlaceholder(dealName)) {
                    continue;
                }

                // Verify it's a reasonable length and not too generic
                if (dealName.length > 5 && dealName.length < 100 && !this._isTooGeneric(dealName)) {
                    return {
                        fact: dealName,
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
     * Priority 2: Extract thesis/strategy statement
     * Looks for sentences containing strategy keywords
     * Example: "focuses on ground-up multifamily in Texas"
     */
    static _extractThesis(profile, profileLower) {
        // Split into sentences
        const sentences = profile.match(/[^.!?]+[.!?]+/g) || [];

        for (const sentence of sentences) {
            const sentenceLower = sentence.toLowerCase();

            // Check if sentence contains thesis keywords
            if (!this.THESIS_KEYWORDS.some(kw => sentenceLower.includes(kw))) {
                continue;
            }

            // Extract the sentence, clean it up
            let fact = sentence
                .trim()
                .replace(/^[A-Z][a-z]+:\s*/, '') // Remove "Caption: " prefix
                .replace(/^-\s*/, '') // Remove "- " prefix
                .substring(0, 150); // Limit to 150 chars

            // Reject if it's too generic or contains banned phrases
            if (this._isTooGeneric(fact) || this._hasBannedPhrase(fact)) {
                continue;
            }

            return {
                fact: fact.trim(),
                fact_type: 'THESIS',
                confidence: 0.85,
                reason: 'Strategy/thesis statement extracted'
            };
        }

        return null;
    }

    /**
     * Priority 3: Extract scale facts
     * Looks for numbers followed by scale keywords
     * Example: "over 22,000 units", "2,500 apartments"
     */
    static _extractScale(profile, profileLower) {
        // Match number + scale keyword pattern
        const patterns = [
            /([0-9,]+(?:\.[0-9]+)?)\s*(?:\+|plus|over|approximately|~)\s*([0-9,]+)\s*(units|unit|properties|property|buildings|building|homes|home|suites|suite)/gi,
            /([0-9,]+(?:\.[0-9]+)?)\s*(units|unit|properties|property|buildings|building|homes|home|suites|suite|bedrooms|beds|apartments|apartment|condos|condo)/gi
        ];

        for (const pattern of patterns) {
            const match = profile.match(pattern);
            if (match) {
                const scaleFact = match[0].trim();
                
                // Make sure it's actually a large number (not just 2 or 3)
                const numbers = match[0].match(/\d+/g);
                if (numbers && Math.max(...numbers.map(n => parseInt(n))) > 100) {
                    return {
                        fact: scaleFact,
                        fact_type: 'SCALE',
                        confidence: 0.90,
                        reason: 'Portfolio scale fact detected'
                    };
                }
            }
        }

        return null;
    }

    /**
     * Priority 4: Extract general focus
     * Broad statements about company focus
     * Example: "focus on ground up multifamily in Texas"
     */
    static _extractGeneralFocus(profile, profileLower, companyName) {
        // Look for "company focuses on X" patterns
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
                    return {
                        fact: focus,
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
     * Check if a string is a placeholder
     */
    static _isPlaceholder(text) {
        const lower = text.toLowerCase();
        return this.PLACEHOLDER_KEYWORDS.some(ph => lower.includes(ph));
    }

    /**
     * Check if a string is too generic or lacks substance
     */
    static _isTooGeneric(text) {
        const genericTerms = [
            'alternative investments',
            'global reach',
            'years in business',
            'impressed',
            'synergies',
            'company',
            'firm',
            'organization',
            'group'
        ];

        const lower = text.toLowerCase();
        
        // Check if it's just listing generic terms
        const matchCount = genericTerms.filter(term => lower.includes(term)).length;
        if (matchCount > 1) {
            return true;
        }

        // If it's too vague (only contains "company" or "firm" + nothing specific)
        if (lower.length < 20) {
            return true;
        }

        return false;
    }

    /**
     * Check for banned phrases that should disqualify a fact
     */
    static _hasBannedPhrase(text) {
        const bannedPhrases = [
            'AUM', 'assets under management',
            'global reach',
            'number of offices',
            'years in business',
            'awards',
            'transaction volume',
            'employee count',
            'founded in',
            'since 19',
            'since 20'
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
