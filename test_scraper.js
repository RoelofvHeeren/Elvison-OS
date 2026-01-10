import axios from 'axios';
import * as cheerio from 'cheerio';

async function testScrape(url) {
    console.log(`\n--- TESTING ${url} ---`);
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        const links = [];
        $('a').each((i, el) => {
            const href = $(el).attr('href');
            if (href) links.push(href);
        });

        console.log(`Status: ${response.status}`);
        console.log(`Found ${links.length} links`);
        console.log(`Common team links found:`, links.filter(l => /team|about|people/i.test(l)));

    } catch (e) {
        console.error(`Error: ${e.message}`);
        if (e.response) {
            console.error(`Status: ${e.response.status}`);
        }
    }
}

async function runTests() {
    await testScrape('https://fifthaveproperties.com');
    await testScrape('https://fifthavehomes.com');
    await testScrape('https://fifthavehomes.com/our-team/');
}

runTests();
