
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';

const MARKETS = [
    { city: 'San Antonio', state: 'TX' },
    { city: 'Phoenix', state: 'AZ' },
    { city: 'Las Vegas', state: 'NV' },
    { city: 'Houston', state: 'TX' },
    { city: 'Dallas', state: 'TX' }
];

async function reGatherCandidates(targetCount = 143) {
    console.log(`🚀 RE-GATHERING CANDIDATES (Target: ${targetCount})...\n`);

    let candidateOwners = [];

    for (const market of MARKETS) {
        if (candidateOwners.length >= targetCount) break;

        try {
            console.log(`   Fetching data for ${market.city}, ${market.state}...`);
            const response = await axios.get('https://api.rentcast.io/v1/properties', {
                params: {
                    city: market.city,
                    state: market.state,
                    propertyType: 'Single Family',
                    limit: 200
                },
                headers: { 'X-Api-Key': RENTCAST_API_KEY }
            });

            console.log(`   Found ${response.data.length} properties.`);

            for (const prop of response.data) {
                if (!prop.owner?.names || !prop.owner.names[0]) continue;

                const ownerName = prop.owner.names[0];
                const ownerType = prop.owner.type;

                // Simple exclusion logic
                if (ownerName.match(/LLC|Inc|Trust|Corp|Limit|Holding|LP|Bank/i) || ownerType !== 'Individual') {
                    continue;
                }

                candidateOwners.push({
                    name: ownerName,
                    propertyAddress: prop.formattedAddress,
                    mailingAddress: prop.owner.mailingAddress?.formattedAddress,
                    city: market.city,
                    state: market.state
                });

                if (candidateOwners.length >= targetCount) break;
            }
        } catch (e) {
            console.log(`   Error fetching ${market.city}: ${e.message}`);
        }
    }

    console.log(`\n✅ Successfully re-gathered ${candidateOwners.length} candidates.`);
    fs.writeFileSync('candidate_owners.json', JSON.stringify(candidateOwners, null, 2));
    console.log('Saved to candidate_owners.json');
}

reGatherCandidates(143);
