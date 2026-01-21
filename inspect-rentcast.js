import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function inspectRawData(zipCode) {
    try {
        console.log(`🔍 Fetching raw property data for ${zipCode}...`);

        const response = await axios.get(`${BASE_URL}/properties`, {
            params: {
                zipCode: zipCode,
                propertyType: 'Single Family',
                limit: 10 // Just 10 to inspect
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY
            }
        });

        const properties = response.data;
        console.log(`\nFound ${properties.length} properties.\n`);

        // Inspect the structure
        for (let i = 0; i < Math.min(3, properties.length); i++) {
            const prop = properties[i];
            console.log(`\n--- PROPERTY ${i + 1} ---`);
            console.log(`Address: ${prop.formattedAddress || prop.address}`);
            console.log(`Owner: ${prop.ownerName || 'N/A'}`);
            console.log(`Owner Occupied: ${prop.ownerOccupied}`);
            console.log(`Owner Address: ${prop.ownerAddress || 'N/A'}`);
            console.log('\nFull Object Keys:', Object.keys(prop));
        }

    } catch (e) {
        if (e.response) {
            console.error('❌ API Error:', e.response.status, e.response.data);
        } else {
            console.error('❌ Error:', e.message);
        }
    }
}

// Run inspection
inspectRawData('78704');
