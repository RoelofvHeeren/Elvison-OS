import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);

/**
 * LLM Outreach Generator
 * Generates high-quality, reasoned outreach messages using Gemini 2.0 Flash.
 * Replaces rigid templates with contextual understanding of value proposition.
 */
const LLMOutreachGenerator = {
    /**
     * Generate a personalized message based on research facts
     * 
     * @param {Object} context
     * @param {string} context.companyName - Target company name
     * @param {string} context.personName - Recipient name
     * @param {string} context.icpType - e.g., "Family Office", "Investment Fund"
     * @param {string} context.investmentThesis - Extracted thesis/focus
     * @param {Array} context.portfolioDeals - List of deal objects (name, units, location)
     * @param {string} context.companyProfile - Full profile text
     * @returns {Promise<Object>} { linkedin_message, email_subject, email_body, reasoning }
     */
    async generate(context) {
        try {
            const {
                companyName,
                personName,
                icpType,
                investmentThesis,
                portfolioDeals = [],
                companyProfile
            } = context;

            const firstName = personName ? personName.split(' ')[0] : 'there';

            // value proposition context
            const myCompany = "Fifth Avenue Properties";
            const myValueProp = "We are residential developers looking for LP/Co-GP equity partners for our pipeline of multifamily projects.";

            // Prepare deal context (top deal)
            const topDeal = portfolioDeals && portfolioDeals.length > 0 ? portfolioDeals[0] : null;
            const dealString = topDeal
                ? `Specific Deal: ${topDeal.name} (${topDeal.units || ''} units in ${topDeal.location || ''})`
                : "No specific deal found.";

            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.4
                }
            });

            const prompt = `
            You are an expert real estate deal originator writing a peer-to-peer outreach message.

            RECIPIENT: ${firstName} at ${companyName} (${icpType})
            THEIR FOCUS: ${investmentThesis || 'Real estate investment'}
            THEIR HIGHLIGHT: ${dealString}
            THEIR PROFILE: ${companyProfile ? companyProfile.substring(0, 500) + '...' : 'N/A'}

            YOUR IDENTITY: Roelof from ${myCompany}.
            YOUR OFFER: ${myValueProp}

            TASK:
            1. REASONING: Briefly explain WHY they would be interested (connect their thesis/deal to our offer).
            2. WRITE LINKEDIN: A short, casual, but professional connection note (max 300 chars).
            3. WRITE EMAIL SUBJECT: Specific and relevant (max 6 words).
            4. WRITE EMAIL BODY: A slightly longer version of the LinkedIn note (max 100 words).

            GUIDELINES:
            - Tone: Peer-to-peer, professional, not "salesy".
            - Hook: Mention their specific deal ("${topDeal ? topDeal.name : ''}") OR their specific thesis.
            - Goal: Open a conversation about partnering on future deals.
            - NO fluff ("I hope this finds you well", "synergies", "innovative").
            - NO generic praise ("Impressive track record").
            - Be direct: "I saw X, thought of Y."

            JSON OUTPUT STRUCTURE:
            {
                "reasoning": "string",
                "linkedin_message": "string",
                "email_subject": "string",
                "email_body": "string"
            }
            `;

            console.log(`[LLMOutreach] Generating message for ${companyName} using Gemini 2.0 Flash...`);
            const result = await model.generateContent(prompt);
            const response = JSON.parse(result.response.text());

            return response;

        } catch (error) {
            console.error('[LLMOutreach] Error generating message:', error);
            return null; // Fallback to template handling in caller
        }
    }
};

export default LLMOutreachGenerator;
