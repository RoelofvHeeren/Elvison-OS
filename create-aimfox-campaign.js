import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const createCampaign = async () => {
    try {
        const apiKey = process.env.AIMFOX_API_KEY;
        const ownerId = "1286281176"; // From inspected campaign

        console.log("Creating campaign 'AI Elvison OS Test'...");

        const payload = {
            "name": "AI Elvison OS Test",
            "type": "list",
            "outreach_type": "connect",
            "account_ids": [ownerId],
            "audience_size": 100, // Dummy value
            "uses_connection_note": true // Try setting this on creation
        };

        const response = await axios.post(`https://api.aimfox.com/api/v2/campaigns`, payload, {
            headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        console.log("Campaign Created!");
        console.log("ID:", response.data.campaign.id);
        console.log("Full Response:", JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error("Error creating campaign:", error.response ? error.response.data : error.message);
    }
};

createCampaign();
