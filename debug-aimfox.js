
import axios from 'axios';

// User provided key
const API_KEY = 'b36561c3-b06f-4461-b88c-945502e623d3';
const BASE_URL = 'https://api.aimfox.com/api/v2';

async function testAimfox() {
    console.log('🔍 Testing Aimfox Connectivity...');
    console.log(`Key: ${API_KEY.substring(0, 8)}...`);

    try {
        console.log('\n--- Fetching Campaigns ---');
        const response = await axios.get(`${BASE_URL}/campaigns`, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('✅ Status:', response.status);
        console.log('✅ Campaigns Found:', response.data.length || response.data?.data?.length);
        console.log('Structure sample:', JSON.stringify(response.data, null, 2).substring(0, 500));

    } catch (error) {
        console.error('❌ Failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Possible Network/DNS issue or incorrect URL.');
        }
    }
}

testAimfox();
