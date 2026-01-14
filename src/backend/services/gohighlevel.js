import axios from 'axios';

class GoHighLevelService {
    constructor() {
        this.customFieldCache = null;
    }

    get apiKey() {
        return process.env.GHL_API_KEY;
    }

    get locationId() {
        return process.env.GHL_LOCATION_ID || '5tJd1yCE13B3wwdy9qvl';
    }

    get baseUrl() {
        // Use API v2 for Private Integration Tokens (PIT)
        return 'https://services.leadconnectorhq.com';
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
        try {
            const fields = await this.getCustomFields();

            // Map our internal names to GHL field names (case-insensitive search)
            const findFieldId = (nameQuery) => {
                const field = fields.find(f => f.name.toLowerCase() === nameQuery.toLowerCase());
                return field ? field.id : null;
            };

            return {
                emailFieldId: findFieldId('Email Copy'),
                linkedinFieldId: findFieldId('Linkedin Message'),
                companyProfileId: findFieldId('Company Profile')
            };
        } catch (error) {
            console.error('Error resolving custom fields:', error.message);
            return {};
        }
    }

    // =====================
    // TAGS
    // =====================

    async listTags() {
        const key = this.apiKey ? this.apiKey.trim() : null;
        if (!key) {
            console.error('GHL_API_KEY is missing/empty during listTags call');
            return [];
        }

        const url = `${this.baseUrl}/locations/${this.locationId}/tags`;
        console.log(`[GHL] Fetching tags from: ${url}`);

        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${key}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            });

            const tags = response.data.tags || [];
            console.log(`[GHL] Successfully fetched ${tags.length} tags`);

            return tags.map(t => ({
                id: t.name,
                name: t.name
            }));
        } catch (error) {
            // Log full error for debugging but don't crash
            console.error('[GHL] Failed to list tags:', error.message);
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

        // Dynamically find field IDs if not provided
        if (!fieldIds) {
            fieldIds = await this.ensureElvisonFields();
            console.log('[GHL] Resolved Field IDs:', fieldIds);
        }

        const customData = lead.custom_data || {};
        const emailMessage = lead.email_body || customData.email_message || '';
        const connectionRequest = lead.linkedin_message || customData.connection_request || ''; // This maps to "Linkedin Message" based on user context
        const companyProfile = customData.company_profile || '';

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

            // Add Custom Fields if IDs were resolved
            if (fieldIds.emailFieldId && emailMessage) {
                payload.customFields.push({ id: fieldIds.emailFieldId, value: emailMessage });
            }
            if (fieldIds.linkedinFieldId && connectionRequest) {
                payload.customFields.push({ id: fieldIds.linkedinFieldId, value: connectionRequest });
            }
            if (fieldIds.companyProfileId && companyProfile) {
                payload.customFields.push({ id: fieldIds.companyProfileId, value: companyProfile });
            }

            console.log('[GHL] Creating contact payload:', JSON.stringify(payload, null, 2));

            const response = await axios.post(
                `${this.baseUrl}/contacts`,
                payload,
                { headers: this._getHeaders() }
            );

            console.log(`[GHL] Contact created successfully: ${response.data.contact?.id}`);
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
