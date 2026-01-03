
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const performBingSearch = async (query) => {
    const cleanQuery = query || "";
    if (!cleanQuery) return [];

    console.log(`[Search] Bing search for: "${cleanQuery}"`);

    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`;

    let rawHtml = '';
    try {
        console.log(`[Search] Trying Bing URL: ${bingUrl}`);
        const response = await axios.get(bingUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://www.bing.com/',
            }
        });
        rawHtml = response.data;
    } catch (err) {
        console.error(`[Search] Bing failed: ${err.message}`);
        return [];
    }

    // Save raw HTML for debugging
    const debugHtmlPath = path.join(__dirname, '../debug_bing_search.html');
    await fs.promises.writeFile(debugHtmlPath, rawHtml);
    console.log(`✅ Raw HTML saved to ${debugHtmlPath}`);

    const $ = cheerio.load(rawHtml);
    const results = [];

    // Bing selectors
    // Results are typically in #b_results > li.b_algo
    $('#b_results > li.b_algo').each((i, el) => {
        if (i >= 20) return false;

        const titleEl = $(el).find('h2 a');
        const snippetEl = $(el).find('.b_caption p');

        const title = titleEl.text().trim();
        const link = titleEl.attr('href');
        const snippet = snippetEl.text().trim();

        if (title && link && link.startsWith('http')) {
            results.push({ title, link, snippet });
        }
    });

    console.log(`[Search] Found ${results.length} results.`);
    return results;
};

(async () => {
    const query = 'Canadian real estate investment firms investing in residential developments LP co-GP';
    console.log(`🔎 Debugging Search for: "${query}"`);
    const results = await performBingSearch(query);

    if (results.length > 0) {
        console.log("✅ Parsing Successful. Top 3 Results:");
        results.slice(0, 3).forEach((r, i) => {
            console.log(`${i + 1}. ${r.title}`);
            console.log(`   ${r.link}`);
            console.log(`   "${r.snippet.substring(0, 50)}..."`);
        });
    } else {
        console.log("❌ No results found.");
    }
})();
