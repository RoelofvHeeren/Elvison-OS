import { researchCompanyTeam } from './src/backend/services/team-extractor-service.js';
import dotenv from 'dotenv';

dotenv.config();

async function runTest(url) {
    console.log(`\n\n=== TESTING RESEARCH FOR: ${url} ===`);
    try {
        const result = await researchCompanyTeam(url);
        console.log(`Company: ${result.companyName}`);
        console.log(`Pages scraped: ${result.pageCount}`);
        console.log(`Team Members Found: ${result.teamMembers.length}`);

        result.teamMembers.forEach(m => {
            console.log(` - ${m.name} (${m.title}) ${m.isDecisionMaker ? '[DM]' : ''}`);
        });

    } catch (e) {
        console.error(`Error during test:`, e);
    }
}

async function main() {
    // Test the SPA case
    await runTest('https://fifthaveproperties.com');

    // Specifically test the case where we have a full URL
    await runTest('https://fifthavehomes.com/our-team/');
}

main();
