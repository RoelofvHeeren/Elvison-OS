
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const token = process.env.APIFY_API_TOKEN;
const datasetId = 'pZS1uRO0DbOROpqGv';

async function debug() {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=1`;
    const res = await axios.get(url);
    console.log('--- FULL ITEM ---');
    console.log(JSON.stringify(res.data[0], null, 2));
    process.exit(0);
}
debug();
