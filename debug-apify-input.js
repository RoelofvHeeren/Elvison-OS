
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const APIFY_API_TOKEN = process.env.APIFY_API_TOKEN;
const RUN_ID = 'pl8BTyI6uLt2nshy9'; // Retry run ID

async function checkInput() {
    if (!APIFY_API_TOKEN) {
        console.error("No APIFY_API_TOKEN found in .env");
        return;
    }

    try {
        console.log(`Checking Input for run ${RUN_ID}...`);

        const runRes = await axios.get(`https://api.apify.com/v2/actor-runs/${RUN_ID}?token=${APIFY_API_TOKEN}`);
        const inputId = runRes.data.data.defaultKeyValueStoreId;

        const inputRes = await axios.get(`https://api.apify.com/v2/key-value-stores/${inputId}/records/INPUT?token=${APIFY_API_TOKEN}`);
        console.log(JSON.stringify(inputRes.data, null, 2));

    } catch (e) {
        console.error("Error:", e.message);
    }
}

checkInput();
