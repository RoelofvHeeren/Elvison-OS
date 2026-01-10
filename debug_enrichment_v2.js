import { enrichContact } from './src/backend/services/contact-enrichment-service.js';
import dotenv from 'dotenv';
dotenv.config();

const testCases = [
    { name: 'Johannes van Leenen', company: 'Fifth Avenue Properties', domain: 'fifthaveproperties.com' },
    { name: 'Jeff van Leenen', company: 'Fifth Avenue Properties', domain: 'fifthaveproperties.com' },
    { name: 'Jamie Renaud', company: 'Fifth Avenue Properties', domain: 'fifthaveproperties.com' },
    { name: 'David Lee', company: 'Fifth Avenue Properties', domain: 'fifthaveproperties.com' }
];

async function runDebug() {
    console.log('Starting enrichment debug...');

    for (const test of testCases) {
        console.log(`\n--- Testing: ${test.name} (${test.company}) ---`);
        try {
            const result = await enrichContact(test.name, test.company); // Note: We need to update this sig later
            console.log('LinkedIn Found:', result.linkedin);
            console.log('Email Found:', result.email);
            console.log('Raw Top 3 Search Results:');
            result.searchResults.slice(0, 3).forEach((r, i) => {
                console.log(`  [${i + 1}] Title: ${r.title}`);
                console.log(`      Link:  ${r.link}`);
                console.log(`      Snip:  ${r.snippet}`);
            });
        } catch (e) {
            console.error('Error:', e);
        }
    }
}

runDebug();
