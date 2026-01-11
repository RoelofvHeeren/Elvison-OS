import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const flowId = "e6cedf1e-bf8d-4a80-9256-9fdc23854d90";

const updateFlow = async () => {
    try {
        const apiKey = process.env.AIMFOX_API_KEY;
        const headers = { 'Authorization': `Bearer ${apiKey}` };

        console.log(`Updating flow: ${flowId}...`);

        // Payload for flow update
        const payload = {
            id: flowId,
            type: "PRIMARY_CONNECT",
            template: "{{connectionRequest}}"
        };

        // Try PATCH /api/v2/flows/:id
        // Note: URL might be inferred, usually strictly RESTful
        const url = `https://api.aimfox.com/api/v2/flows/${flowId}`;

        const response = await axios.patch(url, payload, { headers });

        console.log("Flow Update Success!");
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error("Flow Update Error:", error.response ? error.response.data : error.message);
    }
};

updateFlow();
