import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function findRetailInvestors(city, state) {
    try {
        console.log(`🔍 Searching for property owners in ${city}, ${state}...\n`);

        // Fetch properties (will use ~1 request per batch)
        const response = await axios.get(`${BASE_URL}/properties`, {
            params: {
                city,
                state,
                limit: 30, // Conservative limit
                propertyType: 'Single Family'
            },
            headers: { 'X-Api-Key': RENTCAST_API_KEY }
        });

        const properties = response.data;
        console.log(`Found ${properties.length} properties.`);

        // Aggregate by owner
        const ownerMap = new Map();
        let processedCount = 0;
        let llcCount = 0;

        for (const prop of properties) {
            if (!prop.owner?.names) continue;

            const ownerName = prop.owner.names[0]; // Primary owner
            const ownerType = prop.owner.type;

            // Filter out corporate owners
            if (ownerName.match(/LLC|Inc|Trust|Corp|Limit|Holding|LP|Properties/i) || ownerType !== 'Individual') {
                llcCount++;
                continue;
            }

            if (!ownerMap.has(ownerName)) {
                ownerMap.set(ownerName, {
                    name: ownerName,
                    mailingAddress: prop.owner.mailingAddress?.formattedAddress,
                    ownerOccupied: prop.ownerOccupied,
                    properties: []
                });
            }
            ownerMap.get(ownerName).properties.push(prop.formattedAddress);
            processedCount++;
        }

        console.log(`\n📊 Stats:`);
        console.log(`  Processed: ${processedCount} individual-owned properties`);
        console.log(`  Filtered out: ${llcCount} LLC/corporate-owned`);
        console.log(`  API Requests: ~1/50\n`);

        // Find multi-property owners
        console.log(`--- 🎯 RETAIL INVESTOR LEADS (2+ Properties) ---\n`);

        const investors = [];
        for (const [name, data] of ownerMap.entries()) {
            if (data.properties.length >= 2) {
                investors.push(data);
                console.log(`👤 ${name}`);
                console.log(`   Portfolio: ${data.properties.length} properties`);
                console.log(`   Mailing: ${data.mailingAddress || 'N/A'}`);
                console.log(`   Owner Occupied: ${data.ownerOccupied !== false ? 'Maybe' : 'No'}\n`);
            }
        }

        if (investors.length === 0) {
            console.log('⚠️ No multi-property individual owners found in this sample.');
            console.log('This is normal - try expanding the search limit or different cities.\n');
        }

        return investors;

    } catch (e) {
        console.error('❌ Error:', e.response?.data || e.message);
        return [];
    }
}

// Test with San Antonio (confirmed to have owner data)
findRetailInvestors('San Antonio', 'TX');
