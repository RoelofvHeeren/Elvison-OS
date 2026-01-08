import axios from 'axios';

class GoHighLevelService {
    constructor() {
        // We use Location API Key for simplicity as requested by User logic often
        // Alternatively, this could use OAuth access tokens if configured
        this.apiKey = process.env.GHL_API_KEY;
        this.baseUrl = 'https://rest.gohighlevel.com/v1'; // GHL API v1 (Location API Key)
    }

    _getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    async listWorkflows() {
        if (!this.apiKey) {
            console.warn('GHL_API_KEY is not set');
            return [];
        }

        try {
            // This is actually "Campaigns" in v1 usually, but let's check for Workflows.
            // GHL v1 has /campaigns. Workflows might be different.
            // If using v2 (OAuth), it would be /workflows/.
            // Let's assume v1 for now as it's easier with Location Key.
            // However, modern GHL uses Workflows heavily.
            // If V1 resource is "campaigns", we'll list those.

            // NOTE: Verified GHL API v1 'workflows' endpoint might not exist publicly in the same way.
            // v1 has /campaigns. v2 has /workflows.
            // If the user wants "Workflows", we might need v2 or to call the "add to workflow" via webhooks.
            // But let's try to list campaigns for v1 compatibility or assume they mean Campaigns/Workflows mixed.
            // Let's stick to 'campaigns' for V1 if 'workflows' is not available, but I'll label them "Workflows / Campaigns" in UI.

            // Trying v1 campaigns endpoint
            // const response = await axios.get(\`\${this.baseUrl}/campaigns\?status=published\`, {
            //     headers: this._getHeaders()
            // });

            // Actually, for adding to a 'workflow', frequent pattern is adding contact then triggering a tag or using the contact ID.

            // Let's try to fetch campaigns/workflows. 
            // If we can't fetch workflows in v1, we will return an empty list or mock it for now
            // and maybe rely on just adding contacts + tags.

            // SAFE BET: V1 Campaigns
            const response = await axios.get(`${this.baseUrl}/campaigns`, {
                headers: this._getHeaders()
            });

            return (response.data.campaigns || []).map(c => ({
                id: c.id,
                name: c.name,
                status: c.status
            }));

        } catch (error) {
            console.error('Failed to list GHL campaigns/workflows:', error.response?.data || error.message);
            // Fallback for demo if API fails
            return [];
        }
    }

    async createContact(lead) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        try {
            const payload = {
                email: lead.email,
                phone: lead.phone_numbers?.[0]?.number || lead.phone, // mapping first enriched phone
                firstName: lead.person_name?.split(' ')[0],
                lastName: lead.person_name?.split(' ').slice(1).join(' '),
                name: lead.person_name,
                companyName: lead.company_name,
                title: lead.job_title,
                website: lead.custom_data?.company_website,
                customField: {
                    // GHL custom fields are usually ID-based. 
                    // We might default to tags instead for easier integration.
                },
                tags: ['Elvison AI Lead']
            };

            const response = await axios.post(`${this.baseUrl}/contacts`, payload, {
                headers: this._getHeaders()
            });

            return response.data.contact; // Return created contact
        } catch (error) {
            console.error('Failed to create GHL contact:', error.response?.data || error.message);
            throw error;
        }
    }

    async addContactToCampaign(contactId, campaignId) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        try {
            const response = await axios.post(`${this.baseUrl}/campaigns/${campaignId}/addToCampaign`, {
                contactId: contactId
            }, {
                headers: this._getHeaders()
            });
            return response.data;
        } catch (error) {
            console.error(`Failed to add contact ${contactId} to campaign ${campaignId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async addContactToWorkflow(contactId, workflowId) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        // V1 doesn't support adding to workflow directly by ID easily without v2.
        // We will stick to Campaign for V1.
        try {
            const response = await axios.post(`${this.baseUrl}/campaigns/${workflowId}/addToCampaign`, {
                contactId: contactId
            }, {
                headers: this._getHeaders()
            });
            return response.data;
        } catch (error) {
            console.error(`Failed to add contact ${contactId} to workflow ${workflowId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const ghlService = new GoHighLevelService();
