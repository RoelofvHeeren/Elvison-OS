import axios from 'axios';

class AimfoxService {
    constructor() {
        this.apiKey = process.env.AIMFOX_API_KEY;
        this.baseUrl = 'https://api.aimfox.com/api/v2';
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
            // Map Elvison lead to Aimfox payload
            // Using standard fields + custom variables
            const customData = lead.custom_data || {};

            const payload = {
                linkedin_url: lead.linkedin_url,
                first_name: lead.person_name?.split(' ')[0] || '',
                last_name: lead.person_name?.split(' ').slice(1).join(' ') || '',
                company_name: lead.company_name || '',
                job_title: lead.job_title || '',
                email: lead.email || '',
                // Custom variables array for Aimfox V2
                // Structure typically: [ { name: "var1", value: "val1" } ] or object key-value
                custom_variables: {
                    companyProfile: customData.company_profile || '',
                    connectionRequest: customData.connection_request || '',
                    emailMessage: customData.email_message || ''
                }
            };

            console.log(`[Aimfox] Adding lead to campaign ${campaignId}: ${lead.person_name} (${lead.linkedin_url})`);

            const response = await axios.post(`${this.baseUrl}/campaigns/${campaignId}/leads`, payload, {
                headers: this._getHeaders()
            });

            console.log(`[Aimfox] Lead added successfully.`);
            return response.data;
        } catch (error) {
            console.error(`Failed to add lead to Aimfox campaign ${campaignId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const aimfoxService = new AimfoxService();
