import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);

/**
 * Portfolio Deal Extractor
 * Extracts structured deal/project facts from scraped website content
 * Uses Gemini with structured output to identify specific portfolio items
 */
const PortfolioDealExtractor = {
    /**
     * Extract portfolio deals from content
     * @param {string} content - Scraped website content
     * @param {string} companyName - Company name for context
     * @returns {Promise<Array>} Array of deal objects
     */
    async extractDeals(content, companyName) {
        if (!content || content.length < 100) {
            return [];
        }

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: 'object',
                        properties: {
                            deals: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string', description: 'Project/property name' },
                                        type: { type: 'string', description: 'Deal type (acquisition, development, sale, etc.)' },
                                        units: { type: 'string', description: 'Number of units/square feet (if applicable)' },
                                        location: { type: 'string', description: 'City, state/province, country' },
                                        date: { type: 'string', description: 'Year or date of transaction/completion' },
                                        value: { type: 'string', description: 'Deal value/price (if mentioned)' },
                                        assetClass: { type: 'string', description: 'Asset class (multifamily, office, retail, etc.)' }
                                    },
                                    required: ['name']
                                }
                            }
                        },
                        required: ['deals']
                    }
                }
            });

            const prompt = `You are analyzing website content for ${companyName} to extract specific real estate portfolio deals, projects, or transactions.

INSTRUCTIONS:
1. Extract ONLY concrete, specific deals/projects with actual names
2. Focus on portfolio items, transactions, acquisitions, developments, or properties
3. Include as much detail as possible (units, location, date, value, asset class)
4. If a field is not mentioned, omit it (don't guess or make up data)
5. Prioritize recent deals and larger transactions
6. Extract up to 10 most significant deals

CONTENT TO ANALYZE:
${content.slice(0, 15000)}

Extract all specific portfolio deals/projects mentioned in the content.`;

            const result = await model.generateContent(prompt);
            const response = result.response.text();
            const parsed = JSON.parse(response);

            // Validate and clean deals
            const validDeals = (parsed.deals || [])
                .filter(deal => deal.name && deal.name.length > 3)
                .map(deal => ({
                    ...deal,
                    // Ensure all fields are strings
                    name: String(deal.name || '').trim(),
                    type: String(deal.type || '').trim(),
                    units: String(deal.units || '').trim(),
                    location: String(deal.location || '').trim(),
                    date: String(deal.date || '').trim(),
                    value: String(deal.value || '').trim(),
                    assetClass: String(deal.assetClass || '').trim()
                }));

            console.log(`[PortfolioDealExtractor] Extracted ${validDeals.length} deals for ${companyName}`);
            return validDeals;

        } catch (error) {
            console.error(`[PortfolioDealExtractor] Error extracting deals for ${companyName}:`, error.message);
            return [];
        }
    },

    /**
     * Format deals into a readable research fact
     * @param {Array} deals - Array of deal objects
     * @returns {string} Formatted fact string
     */
    formatDealsAsFact(deals) {
        if (!deals || deals.length === 0) {
            return '';
        }

        // Take top 3 most detailed deals
        const topDeals = deals
            .sort((a, b) => {
                const scoreA = [a.units, a.location, a.date, a.value].filter(Boolean).length;
                const scoreB = [b.units, b.location, b.date, b.value].filter(Boolean).length;
                return scoreB - scoreA;
            })
            .slice(0, 3);

        const dealDescriptions = topDeals.map(deal => {
            const parts = [deal.name];

            if (deal.location) parts.push(`in ${deal.location}`);
            if (deal.units) parts.push(`(${deal.units})`);
            if (deal.date) parts.push(`[${deal.date}]`);
            if (deal.value) parts.push(`valued at ${deal.value}`);

            return parts.join(' ');
        });

        return `Recent portfolio: ${dealDescriptions.join('; ')}`;
    },

    /**
     * Get a single best deal for micro-hook generation
     * @param {Array} deals - Array of deal objects
     * @returns {Object|null} Best deal or null
     */
    getBestDeal(deals) {
        if (!deals || deals.length === 0) {
            return null;
        }

        // Score deals by completeness
        const scored = deals.map(deal => ({
            deal,
            score: [deal.name, deal.units, deal.location, deal.date, deal.value].filter(Boolean).length
        }));

        scored.sort((a, b) => b.score - a.score);
        return scored[0].deal;
    }
};

export default PortfolioDealExtractor;
