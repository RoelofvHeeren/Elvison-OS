import axios from 'axios';

class GoHighLevelService {
    constructor() {
        this.apiKey = process.env.GHL_API_KEY;
        this.baseUrl = 'https://rest.gohighlevel.com/v1';
        this.customFieldCache = null; // Cache custom field IDs
    }

    _getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
        };
    }

    // =====================
    // CUSTOM FIELD MANAGEMENT
    // =====================

    /**
     * Fetches all custom fields for the location.
     * Caches the result to avoid repeated API calls.
     */
    async getCustomFields() {
        if (this.customFieldCache) return this.customFieldCache;

        if (!this.apiKey) {
            console.warn('GHL_API_KEY is not set');
            return [];
        }

        try {
            const response = await axios.get(`${this.baseUrl}/custom-fields`, {
                headers: this._getHeaders()
            });

            this.customFieldCache = response.data.customFields || [];
            return this.customFieldCache;
        } catch (error) {
            console.error('Failed to fetch GHL custom fields:', error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Creates a custom field if it doesn't exist.
     * Returns the field ID.
     */
    async ensureCustomField(fieldKey, fieldName, fieldType = 'TEXT') {
        const fields = await this.getCustomFields();
        const existing = fields.find(f => f.fieldKey === fieldKey);

        if (existing) {
            console.log(`GHL Custom field "${fieldKey}" already exists with ID: ${existing.id}`);
            return existing.id;
        }

        // Create the field
        try {
            const response = await axios.post(`${this.baseUrl}/custom-fields`, {
                name: fieldName,
                fieldKey: fieldKey,
                placeholder: fieldName,
                dataType: fieldType
            }, {
                headers: this._getHeaders()
            });

            const newField = response.data.customField;
            console.log(`GHL Custom field "${fieldKey}" created with ID: ${newField.id}`);

            // Invalidate cache so it's refreshed next time
            this.customFieldCache = null;

            return newField.id;
        } catch (error) {
            console.error(`Failed to create GHL custom field "${fieldKey}":`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Ensures our required custom fields exist and returns their IDs.
     */
    async ensureElvisonFields() {
        const [emailFieldId, linkedinFieldId] = await Promise.all([
            this.ensureCustomField('elvison_email_message', 'Elvison Email Message', 'LARGE_TEXT'),
            this.ensureCustomField('elvison_connection_request', 'Elvison Connection Request', 'LARGE_TEXT')
        ]);

        return { emailFieldId, linkedinFieldId };
    }

    // =====================
    // TAGS
    // =====================

    /**
     * Fetches all tags from GoHighLevel.
     */
    async listTags() {
        if (!this.apiKey) {
            console.warn('GHL_API_KEY is not set');
            return [];
        }

        try {
            const response = await axios.get(`${this.baseUrl}/tags`, {
                headers: this._getHeaders()
            });

            // GHL returns { tags: [{ name: 'tagName' }, ...] }
            return (response.data.tags || []).map(t => ({
                id: t.name, // Use tag name as ID since that's what we pass to createContact
                name: t.name
            }));
        } catch (error) {
            console.error('Failed to list GHL tags:', error.response?.data || error.message);
            return [];
        }
    }

    // =====================
    // CONTACT MANAGEMENT
    // =====================

    /**
     * Creates a contact with custom field values for AI-generated messages.
     * @param {Object} lead - The lead data from Elvison
     * @param {Object} fieldIds - { emailFieldId, linkedinFieldId }
     * @param {string} triggerTag - Tag to add (triggers workflow)
     */
    async createContact(lead, fieldIds = null, triggerTag = 'elvison os') {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        // Ensure fields exist if not provided
        if (!fieldIds) {
            fieldIds = await this.ensureElvisonFields();
        }

        // Extract AI-generated messages from lead.custom_data
        const customData = lead.custom_data || {};
        const emailMessage = customData.email_message || '';
        const connectionRequest = customData.connection_request || '';

        try {
            const payload = {
                email: lead.email,
                phone: lead.phone_numbers?.[0]?.number || lead.phone || '',
                firstName: lead.person_name?.split(' ')[0] || '',
                lastName: lead.person_name?.split(' ').slice(1).join(' ') || '',
                name: lead.person_name || '',
                companyName: lead.company_name || '',
                title: lead.job_title || '',
                website: customData.company_website || '',
                source: 'Elvison AI',
                tags: [triggerTag],
                customField: {}
            };

            // Map custom field IDs to values
            if (fieldIds.emailFieldId && emailMessage) {
                payload.customField[fieldIds.emailFieldId] = emailMessage;
            }
            if (fieldIds.linkedinFieldId && connectionRequest) {
                payload.customField[fieldIds.linkedinFieldId] = connectionRequest;
            }

            console.log(`Creating GHL contact: ${payload.email} with custom fields:`, Object.keys(payload.customField).length);

            const response = await axios.post(`${this.baseUrl}/contacts`, payload, {
                headers: this._getHeaders()
            });

            return response.data.contact;
        } catch (error) {
            console.error('Failed to create GHL contact:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Adds a contact to a campaign (for V1 API).
     */
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

    /**
     * Adds a tag to an existing contact.
     */
    async addTagToContact(contactId, tag) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        try {
            const response = await axios.post(`${this.baseUrl}/contacts/${contactId}/tags`, {
                tags: [tag]
            }, {
                headers: this._getHeaders()
            });
            return response.data;
        } catch (error) {
            console.error(`Failed to add tag "${tag}" to contact ${contactId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const ghlService = new GoHighLevelService();
