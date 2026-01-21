import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function testFullPropertyRecord() {
    try {
        // Step 1: Get a few property IDs from Phoenix
        console.log('🔍 Step 1: Getting property IDs from Phoenix...\n');

        const searchRes = await axios.get(`${BASE_URL}/properties`, {
            params: {
                city: 'Phoenix',
                state: 'AZ',
                limit: 5
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY,
                'accept': 'application/json'
            }
        });

        console.log(`Found ${searchRes.data.length} properties\n`);

        // Step 2: Fetch FULL record for the first property using its ID
        if (searchRes.data.length > 0) {
            const propertyId = searchRes.data[0].id;
            console.log(`🔍 Step 2: Fetching FULL record for property ID: ${propertyId}...\n`);

            const detailRes = await axios.get(`${BASE_URL}/properties/${encodeURIComponent(propertyId)}`, {
                headers: {
                    'X-Api-Key': RENTCAST_API_KEY,
                    'accept': 'application/json'
                }
            });

            const fullRecord = detailRes.data;

            console.log('=== FULL PROPERTY RECORD ===');
            console.log(`Address: ${fullRecord.formattedAddress}`);
            console.log(`Property Type: ${fullRecord.propertyType}`);

            if (fullRecord.owner) {
                console.log('\n✅ OWNER DATA FOUND:');
                console.log(`Owner Name: ${fullRecord.owner.names?.join(', ')}`);
                console.log(`Owner Type: ${fullRecord.owner.type}`);
                console.log(`Mailing Address: ${fullRecord.owner.mailingAddress?.formattedAddress}`);
                console.log(`Owner Occupied: ${fullRecord.ownerOccupied}`);
            } else {
                console.log('\n❌ No owner data in response');
                console.log('Available keys:', Object.keys(fullRecord));
            }

            console.log(`\n📊 Total API Requests: 2/50`);
        }

    } catch (e) {
        console.error('Error:', e.response?.data || e.message);
    }
}

testFullPropertyRecord();
