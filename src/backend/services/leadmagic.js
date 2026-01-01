
import axios from 'axios';

const LEADMAGIC_API_URL = 'https://api.leadmagic.io';

class LeadMagicService {
    constructor(apiKey) {
        this.apiKey = apiKey || process.env.LEADMAGIC_API_KEY;
        if (!this.apiKey) {
            console.warn("LeadMagicService initialized without API Key. Enrichment will fail.");
        }
    }

    /**
     * Enrich a profile using LinkedIn URL to find mobile numbers.
     * Cost: ~5 credits (only if mobile found)
     * @param {string} linkedinUrl 
     * @returns {Promise<Object|null>} Returns phone data or null if not found
     */
    async enrichByLinkedin(linkedinUrl) {
        if (!this.apiKey) throw new Error("Missing LeadMagic API Key");
        if (!linkedinUrl) throw new Error("LinkedIn URL is required");

        try {
            console.log(`[LeadMagic] Enriching: ${linkedinUrl}`);

            const response = await axios.post(
                `${LEADMAGIC_API_URL}/profile-search`, // Verify exact endpoint docs, usually /profile-search or similar
                { profile_url: linkedinUrl },
                {
                    headers: {
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // LeadMagic Response Structure (based on standard mobile enrichment)
            const data = response.data;

            // Log for debugging (remove in prod if sensitive)
            // console.log(`[LeadMagic] Response:`, JSON.stringify(data));

            if (data && (data.mobile_phone || data.phone || (data.phones && data.phones.length > 0))) {
                return {
                    mobile_phone: data.mobile_phone,
                    work_phone: data.work_phone, // often 'corporate_phone'
                    phones: data.phones || [],
                    email: data.work_email || data.email,
                    // They might return other valuable fields
                    linkedin_url: linkedinUrl
                };
            }

            return null; // No phone found
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`[LeadMagic] No data found for ${linkedinUrl}`);
                return null;
            }
            console.error(`[LeadMagic] Error:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const leadMagic = new LeadMagicService();
