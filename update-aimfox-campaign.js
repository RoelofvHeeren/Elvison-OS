import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const campaignId = "e00e94fd-82dd-4015-a5aa-421f96240906"; // The one I just created

const updateCampaign = async () => {
    try {
        const apiKey = process.env.AIMFOX_API_KEY;
        const headers = { 'Authorization': `Bearer ${apiKey}` };

        // 1. Fetch Details to get Flows
        console.log("Fetching campaign details...");
        const detailResponse = await axios.get(`https://api.aimfox.com/api/v2/campaigns/${campaignId}`, { headers });
        const campaign = detailResponse.data.campaign;

        console.log("Current Flows:", JSON.stringify(campaign.flows, null, 2));

        // 2. Find Primary Connect Flow
        const connectFlow = campaign.flows.find(f => f.type === 'PRIMARY_CONNECT');
        if (!connectFlow) {
            console.error("No PRIMARY_CONNECT flow found!");
            return;
        }

        console.log("Found Connect Flow ID:", connectFlow.id);

        // 3. Update the Flow (or Campaign)
        // I will try updating the campaign object with modified flows

        // Modify the flow in memory
        connectFlow.template = "{{connectionRequest}}";
        // Also ensure campaign uses connection note
        campaign.uses_connection_note = true;

        // Payload for update: likely needs just the fields to update?
        // Or full object?

        // Let's try PUT /api/v2/campaigns/:id with just the modified flows and uses_connection_note
        const updatePayload = {
            id: campaignId,
            uses_connection_note: true,
            flows: campaign.flows
        };

        console.log("Sending update...");
        const updateResponse = await axios.patch(`https://api.aimfox.com/api/v2/campaigns/${campaignId}`, updatePayload, { headers });

        console.log("Update Success!");
        console.log(JSON.stringify(updateResponse.data, null, 2));

    } catch (error) {
        console.error("Update Error:", error.response ? error.response.data : error.message);
    }
};

updateCampaign();
