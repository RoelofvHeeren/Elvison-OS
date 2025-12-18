
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const RUN_ID = '5pUaeLdAuhkjbN3Gt'; // From user logs

async function checkLog() {
    if (!APIFY_API_TOKEN) {
        console.error("No APIFY_API_TOKEN found in .env");
        return;
    }

    try {
        console.log(`Checking run ${RUN_ID}...`);

        // 1. Get Run Info (Input)
        const runRes = await axios.get(`https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_API_TOKEN}`);
        console.log("Run Status:", runRes.data.data.status);

        // 2. Get Input used
        const datasetId = runRes.data.data.defaultDatasetId;
        const inputId = runRes.data.data.defaultKeyValueStoreId;

        const inputRes = await axios.get(`https://api.apify.com/v2/key-value-stores/${inputId}/records/INPUT?token=${APIFY_API_TOKEN}`);
        console.log("Input Used:", JSON.stringify(inputRes.data, null, 2));

        // 3. Get Log
        const logRes = await axios.get(`https://api.apify.com/v2/actor-runs/${RUN_ID}/log?token=${APIFY_API_TOKEN}`);
        console.log("\n--- RUN LOG START ---");
        console.log(logRes.data.substring(0, 2000)); // First 2000 chars
        console.log("...\n--- RUN LOG END ---");

    } catch (e) {
        console.error("Error:", e.message);
        if (e.response) console.error(e.response.data);
    }
}

checkLog();
