import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function testOwnerData() {
    try {
        // According to docs, owner data should be in the main /properties response
        // Let's inspect one property carefully

        console.log('🔍 Fetching properties with owner data...\n');

        const response = await axios.get(`${BASE_URL}/properties`, {
            params: {
                city: 'Phoenix',
                state: 'AZ',
                limit: 3
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY,
                'accept': 'application/json'
            }
        });

        console.log(`Found ${response.data.length} properties\n`);

        // Inspect the FULL response structure
        if (response.data.length > 0) {
            console.log('=== FULL PROPERTY OBJECT ===');
            console.log(JSON.stringify(response.data[0], null, 2));
        }

    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}

testOwnerData();
