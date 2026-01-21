import axios from 'axios';

const RENTCAST_API_KEY = 'db09fd6d9dd041de9eb7204f924dbd47';

async function rawResponseTest() {
    try {
        const response = await axios.get('https://api.rentcast.io/v1/properties', {
            params: { address: '5500 Grand Lake Dr, San Antonio, TX, 78244' },
            headers: { 'X-Api-Key': RENTCAST_API_KEY }
        });

        console.log('RAW RESPONSE:');
        console.log(JSON.stringify(response.data, null, 2));
        console.log(`\n📊 Requests used: ~7/50`);
    } catch (e) {
        console.error('Full error:', JSON.stringify(e.response?.data, null, 2));
    }
}

rawResponseTest();
