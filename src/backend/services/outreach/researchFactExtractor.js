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

        // === Priority 2: Scale Facts (Promoted based on user feedback) ===
        // Specific numbers ("178 units", "$3.8B AUM") are better than generic strategies
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
    }

    // ... (skipped _extractNamedDeal) ...

    /**
     * Priority 3: Extract thesis/strategy statement
     * Looks for sentences containing strategy keywords
     */
    static _extractThesis(profile, profileLower, companyName) {
        // ... (existing code inside _extractThesis needs to pass companyName to trimFact) ...
        // We'll trust the existing method signature update or handle it in the next tool call for specific method updates 
        // actually I need to rewrite extract() fully here to change the order.

        // Let's just return the re-ordered extract method here since I selected the whole block? 
        // No, I need to match the target content exactly. 
        // I will replace `extract` method entirely.
    }

    // RETHINKING: The Previous tool call asked to replace specific lines.
    // I will use replace_file_content to swap the order in `extract` and update `_trimFact`.

    // Let's do `extract` first.


    /**
     * Priority 1: Extract named deal/project/asset
     * Looks for proper nouns followed by property keywords
     * Example: "Alpine Village", "Fifth and Main Tower", "Riverside Apartments"
     */
    static _extractNamedDeal(profile, profileLower) {
        // Look for capitalized phrases (proper nouns) followed by property keywords
        // FIXED: Enforce strict capitalization [A-Z] and remove 'i' flag to prevent matching lowercase sentence fragments
        const patterns = [
            // 1. "Named [PropertyType]" format (e.g. "Alpine Village", "Skyline Tower")
            // Captures the FULL phrase (Group 1) by including the property type in the capturing group or matching it whole.
            // We'll capture the whole match here.
            /([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*\s+(?:Condos?|Residences?|Apartments?|Centre|Center|Towers?|Villages?|Lofts?|Developments?|Estates?|Complex(?:es)?|Communit(?:y|ies)|Plaza|Square|Gardens?|Park|Resort|Hotel))/g,

            // 2. "The [Name] at [Location]" format
            /(?:The|the)?\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)\s+(?:at|in|on|phase|parcel)\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)/g,

            // 3. Simple capitalized phrases (proper nouns) - 2+ words followed by a definition verb or noun
            // e.g. "Alpine Village is...", "Alpine Village features..."
            /([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)+)\s+(?:is|features?|includes?|contains?|consists?|development|project|property|asset)/g
        ];

        for (const pattern of patterns) {
            const matches = profile.matchAll(pattern);
            for (const match of matches) {
                let dealName = match[1].trim();

                // For pattern 2, combine the parts: "The X at Y"
                if (match.length > 2 && match[2]) {
                    dealName = `${match[1]} at ${match[2]}`;
                }

                // Reject placeholder names
                if (this._isPlaceholder(dealName)) {
                    continue;
                }

                // Ticket 2: Reject company names that look like deals
                if (this._looksLikeCompanyNameNotDeal(dealName)) {
                    continue;
                }

                // Verify it's a reasonable length and not too generic
                if (dealName.length > 5 && dealName.length < 100 && !this._isTooGeneric(dealName)) {
                    // Ticket 4: Trim fact to max length
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
     * Priority 2 (formerly 3): Extract thesis/strategy statement
     * Looks for sentences containing strategy keywords
     */
    static _extractThesis(profile, profileLower, companyName) {
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
                .substring(0, 200); // Allow more length initially

            // Reject if it's too generic or contains banned phrases
            if (this._isTooGeneric(fact) || this._hasBannedPhrase(fact)) {
                continue;
            }

            // Ticket 4: Trim fact to max length
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

    // ... (skipped unrelated methods) ...

    /**
     * Ticket 4: Smart fact trimming that preserves meaning
     * @param {string} fact - The fact to trim
     * @param {number} maxLen - Maximum length
     * @param {string} companyName - Company name for pronoun replacement
     * @returns {string} Trimmed fact
     */
    static _trimFact(fact, maxLen = 140, companyName = '') {
        if (!fact) return fact;
        let s = fact.trim();

        // Remove leading punctuation/whitespace
        s = s.replace(/^[,:;.\s]+/, '');

        // FIXED: Convert first-person pronouns to Company Name or "They"
        // "We invest..." -> "Forum Asset Management invests..."
        if (companyName) {
            // Remove "The" from company name if it's in the string already to avoid double "The"
            const cleanCompany = companyName.replace(/^The\s+/i, '');
            s = s.replace(/^We\s+/i, `${cleanCompany} `);
            s = s.replace(/^Our\s+/i, `${cleanCompany}'s `);
        } else {
            s = s.replace(/^We\s+/i, 'They ');
            s = s.replace(/^Our\s+/i, 'Their ');
        }

        // Remove "is a company that" fluff if present at start
        s = s.replace(/^(is|are)\s+(a|an)\s+(company|firm|developer|investor)\s+(that|which)\s+/i, '');

        if (s.length <= maxLen) {
            // Remove trailing punctuation
            return s.replace(/[,:;.\s]+$/g, '');
        }

        // CUTTING LOGIC:
        // Cut at maxLen
        let clipped = s.slice(0, maxLen);

        // Try to cut at the last sentence boundary if possible
        const lastPeriod = clipped.lastIndexOf('.');
        if (lastPeriod > maxLen * 0.5) {
            return clipped.slice(0, lastPeriod).replace(/[,:;.\s]+$/g, '');
        }

        // Try to cut at the last comma or conjunction to keep a verified clause
        // e.g. "invests in multifamily, industrial, and office" -> "invests in multifamily, industrial"
        const lastComma = clipped.lastIndexOf(',');
        if (lastComma > maxLen * 0.6) {
            return clipped.slice(0, lastComma).replace(/[,:;.\s]+$/g, '');
        }

        // Fallback: Cut at last word boundary
        return clipped.replace(/\s+\S*$/, '').replace(/[,:;.\s]+$/g, '');
    }

    /**
     * Priority 3: Extract scale facts
     * Looks for numbers followed by scale keywords
     * Example: "over 22,000 units", "2,500 apartments"
     */
    static _extractScale(profile, profileLower) {
        // Match number + scale keyword pattern
        // V5.1 Optimization: Allow 1-2 words between number and unit (e.g. "5,000 multifamily units")
        const patterns = [
            /([0-9,]+(?:\.[0-9]+)?)\s*(?:\+|plus|over|approximately|~)\s*(?:[a-zA-Z-]+\s+){0,2}(units|unit|properties|property|buildings|building|homes|home|suites|suite)/gi,
            /([0-9,]+(?:\.[0-9]+)?)\s*(?:[a-zA-Z-]+\s+){0,2}(units|unit|properties|property|buildings|building|homes|home|suites|suite|bedrooms|beds|apartments|apartment|condos|condo)/gi
        ];

        for (const pattern of patterns) {
            const match = profile.match(pattern);
            if (match) {
                const scaleFact = match[0].trim();

                // Make sure it's actually a large number (not just 2 or 3)
                // Remove commas before parsing to handle "5,000" correctly
                const cleanNumberStr = match[0].replace(/,/g, '');
                const numbers = cleanNumberStr.match(/\d+/g);
                if (numbers && Math.max(...numbers.map(n => parseInt(n))) > 100) {
                    // Ticket 4: Trim fact to max length
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
                    // Ticket 4: Trim fact to max length
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
     * Check if a string is a placeholder
     */
    static _isPlaceholder(text) {
        const lower = text.toLowerCase();
        return this.PLACEHOLDER_KEYWORDS.some(ph => lower.includes(ph));
    }

    /**
     * Ticket 2: Check if text looks like a company name, not a deal name
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
        // Fixed: Lowered threshold from 20 to 5 to allow valid deal names like "A B Tower"
        if (lower.length <= 5) {
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

    /**
     * Ticket 4: Smart fact trimming that preserves meaning
     * @param {string} fact - The fact to trim
     * @param {number} maxLen - Maximum length
     * @param {string} companyName - Company name for pronoun replacement
     * @returns {string} Trimmed fact
     */
    static _trimFact(fact, maxLen = 140, companyName = '') {
        if (!fact) return fact;
        let s = fact.trim();

        // Remove leading punctuation/whitespace
        s = s.replace(/^[,:;.\s]+/, '');

        // FIXED: Convert first-person pronouns to Company Name or "They"
        // "We invest..." -> "Forum Asset Management invests..."
        if (companyName) {
            // Remove "The" from company name if it's in the string already to avoid double "The"
            const cleanCompany = companyName.replace(/^The\s+/i, '');
            s = s.replace(/^We\s+/i, `${cleanCompany} `);
            s = s.replace(/^Our\s+/i, `${cleanCompany}'s `);
        } else {
            s = s.replace(/^We\s+/i, 'They ');
            s = s.replace(/^Our\s+/i, 'Their ');
        }

        // Remove "is a company that" fluff if present at start
        s = s.replace(/^(is|are)\s+(a|an)\s+(company|firm|developer|investor)\s+(that|which)\s+/i, '');

        if (s.length <= maxLen) {
            // Remove trailing punctuation
            return s.replace(/[,:;.\s]+$/g, '');
        }

        // CUTTING LOGIC:
        // Cut at maxLen
        let clipped = s.slice(0, maxLen);

        // Try to cut at the last sentence boundary if possible
        const lastPeriod = clipped.lastIndexOf('.');
        if (lastPeriod > maxLen * 0.5) {
            return clipped.slice(0, lastPeriod).replace(/[,:;.\s]+$/g, '');
        }

        // Try to cut at the last comma or conjunction to keep a verified clause
        // e.g. "invests in multifamily, industrial, and office" -> "invests in multifamily, industrial"
        const lastComma = clipped.lastIndexOf(',');
        if (lastComma > maxLen * 0.6) {
            return clipped.slice(0, lastComma).replace(/[,:;.\s]+$/g, '');
        }

        // Fallback: Cut at last word boundary
        return clipped.replace(/\s+\S*$/, '').replace(/[,:;.\s]+$/g, '');
    }
}

export default ResearchFactExtractor;
