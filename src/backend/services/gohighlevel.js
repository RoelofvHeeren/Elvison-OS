import axios from 'axios';

class GoHighLevelService {
    constructor() {
        this.apiKey = process.env.GHL_API_KEY;
        this.locationId = process.env.GHL_LOCATION_ID || '5tJd1yCE13B3wwdy9qvl';
        // GHL API v2 base URL
        this.baseUrl = 'https://services.leadconnectorhq.com';
        this.customFieldCache = null;
    }

    _getHeaders() {
        return {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'  // Required for v2 API
        };
    }

    // =====================
    // CUSTOM FIELD MANAGEMENT
    // =====================

    async getCustomFields() {
        if (this.customFieldCache) return this.customFieldCache;

        if (!this.apiKey) {
            console.warn('GHL_API_KEY is not set');
            return [];
        }

        try {
            const response = await axios.get(
                `${this.baseUrl}/locations/${this.locationId}/customFields`,
                { headers: this._getHeaders() }
            );

            this.customFieldCache = response.data.customFields || [];
            return this.customFieldCache;
        } catch (error) {
            console.error('Failed to fetch GHL custom fields:', error.response?.data || error.message);
            return [];
        }
    }

    async ensureCustomField(fieldKey, fieldName, fieldType = 'TEXT') {
        const fields = await this.getCustomFields();
        const existing = fields.find(f => f.fieldKey === fieldKey);

        if (existing) {
            console.log(`GHL Custom field "${fieldKey}" already exists with ID: ${existing.id}`);
            return existing.id;
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/locations/${this.locationId}/customFields`,
                {
                    name: fieldName,
                    fieldKey: fieldKey,
                    placeholder: fieldName,
                    dataType: fieldType
                },
                { headers: this._getHeaders() }
            );

            const newField = response.data.customField;
            console.log(`GHL Custom field "${fieldKey}" created with ID: ${newField.id}`);
            this.customFieldCache = null;
            return newField.id;
        } catch (error) {
            console.error(`Failed to create GHL custom field "${fieldKey}":`, error.response?.data || error.message);
            throw error;
        }
    }

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

    async listTags() {
        if (!this.apiKey) {
            console.warn('GHL_API_KEY is not set');
            return [];
        }

        try {
            const response = await axios.get(
                `${this.baseUrl}/locations/${this.locationId}/tags`,
                { headers: this._getHeaders() }
            );

            return (response.data.tags || []).map(t => ({
                id: t.name,  // Use tag name as ID for createContact
                name: t.name
            }));
        } catch (error) {
            console.error('Failed to list GHL tags:', error.response?.data || error.message);
            return [];
        }
    }

    async createTag(tagName) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        try {
            const response = await axios.post(
                `${this.baseUrl}/locations/${this.locationId}/tags`,
                { name: tagName },
                { headers: this._getHeaders() }
            );

            console.log(`GHL Tag "${tagName}" created successfully`);
            return response.data.tag || { name: tagName };
        } catch (error) {
            console.error(`Failed to create GHL tag "${tagName}":`, error.response?.data || error.message);
            throw error;
        }
    }

    // =====================
    // CONTACT MANAGEMENT
    // =====================

    async createContact(lead, fieldIds = null, triggerTag = 'elvison os') {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        // Skip custom fields for now to simplify - just create contact with tag
        // if (!fieldIds) {
        //     fieldIds = await this.ensureElvisonFields();
        // }

        const customData = lead.custom_data || {};
        const emailMessage = customData.email_message || '';
        const connectionRequest = customData.connection_request || '';

        try {
            const payload = {
                locationId: this.locationId,
                email: lead.email,
                phone: lead.phone_numbers?.[0]?.number || lead.phone || '',
                firstName: lead.person_name?.split(' ')[0] || '',
                lastName: lead.person_name?.split(' ').slice(1).join(' ') || '',
                name: lead.person_name || '',
                companyName: lead.company_name || '',
                source: 'Elvison AI',
                tags: [triggerTag],
                customFields: []
            };

            // Add custom fields if we have messages
            if (emailMessage) {
                payload.customFields.push({ key: 'elvison_email_message', value: emailMessage });
            }
            if (connectionRequest) {
                payload.customFields.push({ key: 'elvison_connection_request', value: connectionRequest });
            }

            console.log(`Creating GHL contact: ${payload.email} with tag: ${triggerTag}`);

            const response = await axios.post(
                `${this.baseUrl}/contacts`,
                payload,
                { headers: this._getHeaders() }
            );

            return response.data.contact;
        } catch (error) {
            console.error('Failed to create GHL contact:', error.response?.data || error.message);
            throw error;
        }
    }

    async addTagToContact(contactId, tag) {
        if (!this.apiKey) throw new Error('GHL_API_KEY is missing');

        try {
            const response = await axios.post(
                `${this.baseUrl}/contacts/${contactId}/tags`,
                { tags: [tag] },
                { headers: this._getHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error(`Failed to add tag "${tag}" to contact ${contactId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

export const ghlService = new GoHighLevelService();
