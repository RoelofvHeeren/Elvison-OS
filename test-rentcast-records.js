import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function testRecordsEndpoint() {
    try {
        // Try the /records endpoint which might have owner data
        console.log('Testing /records endpoint for property ownership data...\n');

        const testAddress = '123 Main St, Phoenix, AZ 85004';

        const response = await axios.get(`${BASE_URL}/properties/records`, {
            params: {
                address: testAddress
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY
            }
        });

        console.log('Success! Response structure:');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (e) {
        if (e.response) {
            console.log(`Failed with ${e.response.status}: ${e.response.statusText}`);
            console.log('Response:', e.response.data);
        } else {
            console.error('Error:', e.message);
        }

        console.log('\n🔍 The Free Tier might not include owner data.');
        console.log('Recommendation: Focus on SEC data (which is free) first.\n');
    }
}

testRecordsEndpoint();
