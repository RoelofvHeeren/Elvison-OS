import axios from 'axios';

class AimfoxService {
    constructor() {
        this.apiKey = process.env.AIMFOX_API_KEY;
        this.baseUrl = 'https://api.aimfox.com/v1'; // Assumed version based on docs search
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
            return []; // Return empty if not configured
        }

        try {
            // Note: Endpoint based on search results, might need adjustment if v1/campaigns is different
            const response = await axios.get(`${this.baseUrl}/campaigns`, {
                headers: this._getHeaders()
            });
            // Assume response data structure is { data: [...] } or just [...]
            return response.data.data || response.data || [];
        } catch (error) {
            console.error('Failed to list Aimfox campaigns:', error.response?.data || error.message);
            throw error;
        }
    }

    async addLeadToCampaign(campaignId, lead) {
        if (!this.apiKey) throw new Error('AIMFOX_API_KEY is missing');

        if (!lead.linkedin_url) {
            throw new Error(`Lead ${lead.person_name} is missing LinkedIn URL`);
        }

        try {
            // Mapping Elvison lead to Aimfox payload
            // Aimfox usually requires just the LinkedIn URL or profile ID
            // We'll send what we have.
            const payload = {
                linkedin_url: lead.linkedin_url,
                first_name: lead.person_name?.split(' ')[0],
                last_name: lead.person_name?.split(' ').slice(1).join(' '),
                company_name: lead.company_name,
                job_title: lead.job_title,
                email: lead.email,
                // Custom variables for personalization
                custom_variables: {
                    companyProfile: lead.custom_data?.company_profile || '',
                    connectionRequest: lead.custom_data?.connection_request || '',
                    // ... other fields
                }
            };

            const response = await axios.post(`${this.baseUrl}/campaigns/${campaignId}/leads`, payload, {
                headers: this._getHeaders()
            });

            return response.data;
        } catch (error) {
            console.error(`Failed to add lead to Aimfox campaign ${campaignId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const aimfoxService = new AimfoxService();
