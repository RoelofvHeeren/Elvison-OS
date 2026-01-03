
import dotenv from 'dotenv';
import { scrapeWebsiteSmart } from '../src/backend/services/apify.js';

dotenv.config();

async function testSmartScraper() {
    const domain = 'anthropic.com';
    const icpContext = {
        icpDescription: "AI research companies building large language models and focusing on safety."
    };

    console.log(`🚀 Testing Smart Scraper for: ${domain}`);
    console.log('Context:', icpContext);

    try {
        const result = await scrapeWebsiteSmart(domain, icpContext);

        console.log('\n✅ Scrape Complete!');
        console.log('-----------------------------------');
        console.log(`Total URLs Scraped: ${result.scrapedUrls.length}`);
        console.log('URLs:', result.scrapedUrls);
        console.log(`Total Content Length: ${result.content.length} chars`);
        console.log('First 500 chars of content:');
        console.log(result.content.slice(0, 500));

    } catch (error) {
        console.error('❌ Test Failed:', error);
    }
}

testSmartScraper();
