import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function testDocExample() {
    try {
        // Use the EXACT address from their documentation
        const address = '5500 Grand Lake Dr, San Antonio, TX, 78244';

        console.log(`🔍 Testing with documentation example address: ${address}\n`);

        const response = await axios.get(`${BASE_URL}/properties`, {
            params: { address },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY,
                'accept': 'application/json'
            }
        });

        const property = response.data;

        console.log('=== PROPERTY RECORD ===');
        console.log(`Address: ${property.formattedAddress}`);
        console.log(`Property Type: ${property.propertyType}`);
        console.log(`Beds/Baths: ${property.bedrooms}/${property.bathrooms}`);

        if (property.owner) {
            console.log('\n✅ OWNER DATA FOUND:');
            console.log(`Owner Name(s): ${property.owner.names?.join(', ')}`);
            console.log(`Owner Type: ${property.owner.type}`);
            console.log(`Mailing Address: ${property.owner.mailingAddress?.formattedAddress}`);
            console.log(`Owner Occupied: ${property.ownerOccupied}`);
        } else {
            console.log('\n❌ No owner data available');
            console.log('This confirms the FREE TIER does not include owner data.');
        }

        console.log(`\n📊 Total API Requests: 1/50`);

    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}

testDocExample();
