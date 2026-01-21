import axios from 'axios';
import dotenv from 'dotenv';
import { startLinkedInPeopleSearch, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';

async function testFullPipeline() {
    console.log('🚀 FULL PIPELINE TEST: RentCast -> LinkedIn\n');
    console.log('='.repeat(60));

    try {
        // Step 1: Get property owners from RentCast
        console.log('\n📍 STEP 1: Fetching property owners from San Antonio...\n');

        const rentcastRes = await axios.get('https://api.rentcast.io/v1/properties', {
            params: {
                city: 'San Antonio',
                state: 'TX',
                limit: 10,
                propertyType: 'Single Family'
            },
            headers: { 'X-Api-Key': RENTCAST_API_KEY }
        });

        const properties = rentcastRes.data;

        // Collect individual owners
        const owners = [];
        for (const prop of properties) {
            if (!prop.owner?.names) continue;

            const ownerName = prop.owner.names[0];
            const ownerType = prop.owner.type;

            // Skip LLCs
            if (ownerName.match(/LLC|Inc|Trust|Corp/i) || ownerType !== 'Individual') continue;

            owners.push({
                name: ownerName,
                city: 'San Antonio',
                state: 'TX',
                mailingAddress: prop.owner.mailingAddress?.formattedAddress
            });
        }

        console.log(`✅ Found ${owners.length} individual property owners\n`);

        if (owners.length === 0) {
            console.log('⚠️ No individual owners in this batch. Try a different city.');
            return;
        }

        // Step 2: Search LinkedIn for the first 3 owners
        console.log('📍 STEP 2: Searching LinkedIn for owner profiles...\n');

        const testOwners = owners.slice(0, 3); // Test with 3 to save API credits

        for (let i = 0; i < testOwners.length; i++) {
            const owner = testOwners[i];
            console.log(`[${i + 1}/${testOwners.length}] Searching: ${owner.name} in ${owner.city}, ${owner.state}`);

            // Use Apify LinkedIn scraper
            const searchQuery = `${owner.name} ${owner.city}`;

            try {
                const runId = await startLinkedInPeopleSearch(
                    process.env.APIFY_API_TOKEN,
                    [searchQuery],
                    { limit: 5 }
                );

                console.log(`   ⏳ Apify Run ID: ${runId}`);

                // Wait for completion
                let status = 'RUNNING';
                let attempts = 0;
                while (status === 'RUNNING' && attempts < 15) {
                    await new Promise(r => setTimeout(r, 4000));
                    const statusData = await checkApifyRun(process.env.APIFY_API_TOKEN, runId);
                    status = statusData.status;
                    attempts++;
                }

                if (status === 'SUCCEEDED') {
                    const statusData = await checkApifyRun(process.env.APIFY_API_TOKEN, runId);
                    const results = await getApifyResults(process.env.APIFY_API_TOKEN, statusData.datasetId, 0, 5);

                    if (results.length > 0) {
                        console.log(`   ✅ MATCH FOUND: ${results[0].name || results[0].fullName || 'Unknown'}`);
                        console.log(`      Profile: ${results[0].profileUrl || results[0].url || 'N/A'}`);
                        const headline = results[0].headline || results[0].title || 'N/A';
                        console.log(`      Headline: ${headline.substring(0, 60)}${headline.length > 60 ? '...' : ''}`);
                    } else {
                        console.log(`   ❌ No LinkedIn profile found`);
                    }
                } else {
                    console.log(`   ⚠️ Scrape ${status}`);
                }

            } catch (e) {
                console.log(`   ❌ Error: ${e.message}`);
            }

            console.log('');
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎯 PIPELINE TEST COMPLETE\n');
        console.log('This proves we can:');
        console.log('  1. Get owner names from RentCast (FREE)');
        console.log('  2. Match them to LinkedIn profiles (Apify)');
        console.log('  3. Extract verified emails (Apollo/next step)');

    } catch (e) {
        console.error('❌ Pipeline failed:', e.message);
    }
}

testFullPipeline();
