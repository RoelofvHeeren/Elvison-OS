
import { secScraperService } from './src/backend/services/sec-scraper-service.js';

console.log('🚀 Starting SEC Integration Verification...');

async function run() {
    try {
        console.log('Calling runCycle()...');
        // Limit to 10 for quick verification
        const results = await secScraperService.runCycle();

        console.log('✅ Cycle complete.');
        console.log(`📊 Processed Funds: ${results.length}`);

        if (results.length > 0) {
            const sample = results[0];
            console.log(`\nSample Fund: ${sample.companyName}`);
            console.log(`Leads Saved: ${sample.leads.length}`);
            if (sample.leads.length > 0) {
                console.log(`First Lead: ${sample.leads[0].name} - ${sample.leads[0].title}`);
            }
        } else {
            console.log('⚠️ No Real Estate funds found in this batch (or scraper filter excluded them).');
        }

        process.exit(0);
    } catch (e) {
        console.error('❌ Verification failed:', e);
        process.exit(1);
    }
}

run();
