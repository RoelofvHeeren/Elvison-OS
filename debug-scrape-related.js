
import { JSDOM } from 'jsdom';
import axios from 'axios';

async function testScrape() {
    const url = 'https://www.related.com';
    console.log(`Fetching ${url}...`);
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36' }
        });
        const dom = new JSDOM(response.data);
        const doc = dom.window.document;

        const bodyText = doc.body.textContent || "";
        console.log(`Body length: ${bodyText.length}`);

        // Check for keywords mentioned by user
        const keywords = ['700 Broadway', 'The Cortland', 'The Maple', 'Riverwalk Heights', 'Residential Offerings'];
        keywords.forEach(kw => {
            const index = bodyText.indexOf(kw);
            console.log(`Keyword "${kw}": ${index !== -1 ? 'FOUND' : 'NOT FOUND'}`);
        });

        // Check for links to properties
        const links = Array.from(doc.querySelectorAll('a')).map(a => a.href);
        const residentialLink = links.find(l => l.includes('residential'));
        console.log(`Residential link found: ${residentialLink || 'NONE'}`);

    } catch (err) {
        console.error("Scraping failed:", err.message);
    }
}

testScrape();
