import { aimfoxService } from './src/backend/services/aimfox.js';
import axios from 'axios';

const inspectCampaigns = async () => {
    try {
        console.log("Fetching campaigns list...");
        const listResponse = await aimfoxService.listCampaigns();

        if (listResponse.length > 0) {
            const campaignId = listResponse[0].id;
            console.log(`fetching details for campaign: ${campaignId}`);

            // Call GET /campaigns/:id directly (Try V2)
            const detailResponse = await axios.get(`https://api.aimfox.com/api/v2/campaigns/${campaignId}`, {
                headers: { 'Authorization': `Bearer ${process.env.AIMFOX_API_KEY}` }
            });

            console.log(JSON.stringify(detailResponse.data, null, 2));
        } else {
            console.log("No campaigns found.");
        }
    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error.message);
    }
};

inspectCampaigns();
