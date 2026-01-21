import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function findRetailInvestorsV2(zipCode) {
    try {
        console.log(`🔍 Searching for properties in ${zipCode}...`);

        // Step 1: Get a list of addresses (Does NOT include owner data)
        const response = await axios.get(`${BASE_URL}/properties`, {
            params: {
                zipCode: zipCode,
                propertyType: 'Single Family',
                limit: 15 // Conservative to avoid hitting limit
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY
            }
        });

        const properties = response.data;
        console.log(`Found ${properties.length} properties. Now fetching owner records...\n`);

        // Step 2: For each property, fetch detailed records (which INCLUDES owner)
        const ownerMap = new Map();
        let requestCount = 1; // Already made 1 request above

        for (const prop of properties.slice(0, 10)) { // Limit to 10 to be safe
            if (requestCount >= 45) {
                console.log('⚠️ Approaching request limit. Stopping early.');
                break;
            }

            try {
                const address = prop.formattedAddress || `${prop.addressLine1}, ${prop.city}, ${prop.state} ${prop.zipCode}`;

                // Fetch detailed property record
                const detailRes = await axios.get(`${BASE_URL}/property`, {
                    params: { address },
                    headers: { 'X-Api-Key': RENTCAST_API_KEY }
                });

                requestCount++;

                const detail = detailRes.data;
                const ownerName = detail.owner?.name || detail.ownerName;
                const ownerAddress = detail.owner?.mailingAddress?.formattedAddress || detail.ownerAddress;
                const ownerOccupied = detail.owner?.ownerOccupied;

                if (ownerName && !ownerName.match(/LLC|Inc|Trust|Corp|Limit|Holding|LP/i)) {
                    if (!ownerMap.has(ownerName)) {
                        ownerMap.set(ownerName, {
                            name: ownerName,
                            mailingAddress: ownerAddress,
                            ownerOccupied,
                            properties: []
                        });
                    }
                    ownerMap.get(ownerName).properties.push(address);
                }

                // Rate limit
                await new Promise(r => setTimeout(r, 100));

            } catch (e) {
                console.log(`Failed to fetch details for ${prop.formattedAddress}`);
            }
        }

        console.log(`\n📊 Total API Requests Used: ${requestCount}/50\n`);
        console.log(`--- 🎯 RETAIL INVESTOR LEADS ---\n`);

        const investors = [];
        for (const [name, data] of ownerMap.entries()) {
            if (data.properties.length >= 1) {
                investors.push(data);
                console.log(`👤 Investor: ${name}`);
                console.log(`   Portfolio: ${data.properties.length} properties`);
                console.log(`   Mailing: ${data.mailingAddress || 'N/A'}`);
                console.log(`   Owner Occupied: ${data.ownerOccupied !== false ? 'Maybe' : 'No'}\n`);
            }
        }

        return investors;

    } catch (e) {
        if (e.response) {
            console.error('❌ API Error:', e.response.status, e.response.data);
        } else {
            console.error('❌ Error:', e.message);
        }
        return [];
    }
}

// Phoenix zip code
findRetailInvestorsV2('85004');
