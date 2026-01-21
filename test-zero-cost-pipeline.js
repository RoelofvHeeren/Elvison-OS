import axios from 'axios';
import dotenv from 'dotenv';
import { startGoogleSearch, checkApifyRun, getApifyResults, startApolloDomainScrape } from './src/backend/services/apify.js';

dotenv.config();

const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

async function testZeroCostPipeline() {
    console.log('🚀 ZERO-COST PIPELINE: RentCast -> Google -> Apollo\n');
    console.log('='.repeat(60));

    try {
        // Step 1: Get property owner from RentCast
        console.log('\n📍 STEP 1: Fetching property owner from RentCast...\n');

        const rentcastRes = await axios.get('https://api.rentcast.io/v1/properties', {
            params: {
                address: '5500 Grand Lake Dr, San Antonio, TX, 78244'
            },
            headers: { 'X-Api-Key': RENTCAST_API_KEY }
        });

        const property = rentcastRes.data[0];
        const ownerName = property.owner.names[0];

        console.log(`✅ Found Owner: ${ownerName}\n`);

        // Step 2: Google Search for LinkedIn
        console.log('📍 STEP 2: Searching Google for LinkedIn profile...\n');

        const searchQuery = `${ownerName} LinkedIn`;
        console.log(`Query: "${searchQuery}"`);

        const googleRunId = await startGoogleSearch(
            APIFY_TOKEN,
            [searchQuery],
            { maxPagesPerQuery: 1 }
        );

        console.log(`Apify Run ID: ${googleRunId}`);

        // Wait for Google search completion
        let status = 'RUNNING';
        let attempts = 0;
        while (status === 'RUNNING' && attempts < 15) {
            await new Promise(r => setTimeout(r, 3000));
            const statusData = await checkApifyRun(APIFY_TOKEN, googleRunId);
            status = statusData.status;
            attempts++;
        }

        if (status === 'SUCCEEDED') {
            const statusData = await checkApifyRun(APIFY_TOKEN, googleRunId);
            const datasetItems = await getApifyResults(APIFY_TOKEN, statusData.datasetId, 0, 10);

            // The Google Scraper returns one item per query, containing "organicResults"
            let linkedinUrl = null;

            if (datasetItems.length > 0 && datasetItems[0].organicResults) {
                const organicResults = datasetItems[0].organicResults;
                console.log(`✅ Found ${organicResults.length} organic results`);

                for (const result of organicResults) {
                    const url = result.url || result.link;
                    const title = result.title || '';
                    const description = result.description || '';

                    // Look for LinkedIn profiles (exclude directory/search pages)
                    if (url && url.includes('linkedin.com/in/') && !url.includes('/dir/') && !url.includes('/pub/dir/')) {
                        console.log(`Potential Match: ${title} (${url})`);

                        // Simple heuristic: "Real Estate", "Capital", "Investor" in title/desc?
                        if ((title + description).match(/Real Estate|Capital|Invest|Property|Owner|Principal|Director/i)) {
                            linkedinUrl = url;
                            console.log('   -> High confidence match!');
                            break; // Take the first high-confidence match
                        } else if (!linkedinUrl) {
                            linkedinUrl = url; // Keep as fallback
                        }
                    }
                }
            }

            if (linkedinUrl) {
                console.log(`✅ FOUND LinkedIn: ${linkedinUrl}\n`);

                // Step 3: Use Apollo to enrich the LinkedIn profile
                console.log('📍 STEP 3: Enriching with Apollo (Email/Phone)...\n');
                console.log(`LinkedIn URL: ${linkedinUrl}`);

                // Bypass helper and call actor directly to try "URL search" mode
                const APOLLO_ACTOR_ID = 'GlxYrQp6f3YAzH2W2'; // Leads Scraper (Rental)

                // Try to find the person by name + location + LinkedIn keyword
                console.log('⏳ Starting Apollo scrape via direct API...');

                const apolloInput = {
                    // Try to use the "Search" mode of the actor
                    qKeywords: linkedinUrl,
                    // Fallback: search by name and location if URL lookup isn't direct
                    personTitles: ["Owner", "Principal", "Director", "Manager"],
                    personLocations: ["San Antonio, TX", "Texas"],
                    // Some actors allow this:
                    personLinkedInUrls: [linkedinUrl]
                };

                console.log(`Input: ${JSON.stringify(apolloInput, null, 2)}`);

                const apolloRes = await axios.post(
                    `https://api.apify.com/v2/acts/${APOLLO_ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
                    apolloInput,
                    { headers: { 'Content-Type': 'application/json' } }
                );

                const apolloRunId = apolloRes.data.data.id;
                console.log(`Apollo Run ID: ${apolloRunId}\n`);

                // Wait for Apollo completion
                status = 'RUNNING';
                attempts = 0;
                while (status === 'RUNNING' && attempts < 20) {
                    await new Promise(r => setTimeout(r, 4000));
                    const statusData = await checkApifyRun(APIFY_TOKEN, apolloRunId);
                    status = statusData.status;
                    attempts++;
                }

                if (status === 'SUCCEEDED') {
                    const statusData = await checkApifyRun(APIFY_TOKEN, apolloRunId);
                    const apolloResults = await getApifyResults(APIFY_TOKEN, statusData.datasetId);

                    if (apolloResults.length > 0) {
                        const contact = apolloResults[0];
                        console.log('\n✅ COMPLETE PROFILE:');
                        console.log(`   Name: ${contact.firstName} ${contact.lastName} (${contact.name || ownerName})`);
                        console.log(`   Job: ${contact.title || contact.headline || 'N/A'}`);
                        console.log(`   Email: ${contact.email || 'N/A'}`);
                        console.log(`   Phone: ${contact.phone || contact.phoneNumbers?.[0] || 'N/A'}`);
                        console.log(`   Company: ${contact.organization?.name || contact.company || 'N/A'}`);
                        console.log(`   LinkedIn: ${contact.linkedinUrl || linkedinUrl}`);
                    } else {
                        console.log('⚠️ No enrichment data returned');
                        console.log('Debug - raw result counts:', apolloResults.length);
                    }
                } else {
                    console.log(`⚠️ Apollo scrape ${status}`);
                }


            } else {
                console.log('❌ No LinkedIn profile found in search results');
            }
        } else {
            console.log(`⚠️ Google search ${status}`);
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎯 ZERO-COST PIPELINE TEST COMPLETE');
        console.log('\nThis workflow uses ONLY tools you already pay for:');
        console.log('  - RentCast Free Tier');
        console.log('  - Apify Google Search');
        console.log('  - Apify Apollo Scraper (already rented)');

    } catch (e) {
        console.error('❌ Pipeline failed:', e.message);
        console.error(e.stack);
    }
}

testZeroCostPipeline();
