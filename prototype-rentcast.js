
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// RentCast API Key (User needs to provide this or we use a placeholder)
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || 'db09fd6d9dd041de9eb7204f924dbd47';
const BASE_URL = 'https://api.rentcast.io/v1';

async function findRetailInvestors(zipCode) {
    try {
        console.log(`🔍 Searching for non-owner occupied properties in ${zipCode}...`);

        // 1. Fetch Properties (Simulated loop for pagination would be here)
        // We look for Single Family Homes (SFH) that are potentially rentals
        const response = await axios.get(`${BASE_URL}/properties`, {
            params: {
                zipCode: zipCode,
                propertyType: 'Single Family',
                limit: 50 // Start small
            },
            headers: {
                'X-Api-Key': RENTCAST_API_KEY
            }
        });

        const properties = response.data;
        console.log(`Found ${properties.length} properties.`);

        // 2. Identify Non-Owner Occupied & Aggregate by Owner
        const portfolioMap = new Map();

        for (const prop of properties) {
            // Check if explicitly marked non-owner occupied (if available)
            // Or infer: Owner Address != Property Address
            // RentCast often provides 'ownerOccupied' boolean

            if (prop.ownerOccupied === false) {
                const ownerName = prop.ownerName || 'Unknown Owner';

                // Exclude Corporate Owners (LLCs, Inc, Trust) to find RETAIL investors
                if (ownerName.match(/LLC|Inc|Trust|Corp|Limit|Holding/i)) {
                    continue; // Skip corporate for now, focusing on individuals
                }

                if (!portfolioMap.has(ownerName)) {
                    portfolioMap.set(ownerName, []);
                }
                portfolioMap.get(ownerName).push(prop);
            }
        }

        // 3. Filter for Multi-Property Owners (2+ properties)
        console.log('\n--- 🎯 RETAIL INVESTOR LEADS (2+ Properties) ---');

        const investors = [];
        for (const [owner, props] of portfolioMap.entries()) {
            if (props.length >= 2) {
                investors.push({ owner, count: props.length, properties: props });
                console.log(`\n👤 Investor: ${owner}`);
                console.log(`   Portfolio Size: ${props.length} properties`);
                console.log(`   Sample Address: ${props[0].formattedAddress}`);
            }
        }

        if (investors.length === 0) {
            console.log('No individual investors with 2+ properties found in this batch.');
        }

        return investors;

    } catch (e) {
        if (e.response?.status === 401) {
            console.error('❌ Error: Invalid or missing RentCast API Key.');
        } else {
            console.error('❌ Error:', e.message);
        }
        return [];
    }
}

// Example usage
findRetailInvestors('78704'); // Austin, TX Zip Code
