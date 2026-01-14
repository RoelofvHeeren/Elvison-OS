import axios from 'axios';
import { normalizeLinkedInUrl } from '../utils/linkedin-utils.js';

class AimfoxService {
    constructor() {
        this.baseUrl = 'https://api.aimfox.com/api/v2';
    }

    get apiKey() {
        return process.env.AIMFOX_API_KEY;
    }

    _getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async listCampaigns() {
        if (!this.apiKey) {
            console.warn('AIMFOX_API_KEY is not set');
            return [];
        }

        try {
            const response = await axios.get(`${this.baseUrl}/campaigns`, {
                headers: this._getHeaders()
            });
            // Verified structure: { status: "ok", campaigns: [...] }
            return response.data.campaigns || [];
        } catch (error) {
            console.error('Failed to list Aimfox campaigns:', error.response?.data || error.message);
            throw error;
        }
    }

    async addLeadToCampaign(campaignId, lead) {
        if (!this.apiKey) throw new Error('AIMFOX_API_KEY is missing');

        // Aimfox V2 usually requires a profile URL
        if (!lead.linkedin_url) {
            console.warn(`Lead ${lead.person_name} is missing LinkedIn URL.`);
            // Proceeding might fail depending on API strictness, but let's try or error out.
        }

        try {
            // Map Elvison lead to Aimfox V2 multiple profiles payload
            const customData = lead.custom_data || {};

            const payload = {
                type: 'profile_url',
                profiles: [{
                    profile_url: normalizeLinkedInUrl(lead.linkedin_url),
                    custom_variables: {
                        firstName: lead.person_name?.split(' ')[0] || '',
                        lastName: lead.person_name?.split(' ').slice(1).join(' ') || '',
                        COMPANYNAME: lead.company_name || '',
                        jobTitle: lead.job_title || '',
                        email: lead.email || '',
                        COMPANYPROFILE: customData.company_profile || '',
                        CONNECTIONREQUEST: lead.linkedin_message || customData.connection_request || '',
                        EMAILMESSAGE: lead.email_body || customData.email_message || ''
                    }
                }]
            };

            console.log(`[Aimfox] Adding lead to campaign ${campaignId}: ${lead.person_name} (${lead.linkedin_url})`);

            const response = await axios.post(`${this.baseUrl}/campaigns/${campaignId}/audience/multiple`, payload, {
                headers: this._getHeaders()
            });

            console.log(`[Aimfox] Response received.`);

            if (response.data.failed && response.data.failed.length > 0) {
                console.warn(`[Aimfox] Some leads failed to add:`, JSON.stringify(response.data.failedReason));
            }

            return response.data;
        } catch (error) {
            console.error(`Failed to add lead to Aimfox campaign ${campaignId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const aimfoxService = new AimfoxService();
