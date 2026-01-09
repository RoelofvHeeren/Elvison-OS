
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export class ResearchService {

    /**
     * Step 1: Scan a company website for relevant pages (Sitemap/Links)
     * @param {string} url - base website URL
     * @param {string} topic - research topic to filter links
     * @returns {Promise<{recommended: Array, all: Array}>}
     */
    static async scanCompany(url, topic) {
        console.log(`🕵️‍♀️ Scanning ${url} for topic: ${topic}...`);

        let rootUrl = url;
        if (!rootUrl.startsWith('http')) rootUrl = 'https://' + rootUrl;
        const domain = new URL(rootUrl).hostname;

        try {
            const allLinks = new Map(); // url -> text

            // Step 1: Try to get sitemap
            console.log('📋 Checking for sitemap...');
            const sitemapUrls = await this.extractSitemapUrls(rootUrl);
            console.log(`Found ${sitemapUrls.length} URLs from sitemap`);

            sitemapUrls.forEach(sitemapUrl => {
                // Use the last part of the URL as the title/text
                const path = new URL(sitemapUrl).pathname;
                const title = path.split('/').filter(Boolean).pop() || 'Page';
                allLinks.set(sitemapUrl, title.replace(/-/g, ' '));
            });

            // Step 2: Crawl homepage
            console.log('🏠 Crawling homepage...');
            const html = await this.fetchHtml(rootUrl);
            const $ = cheerio.load(html);

            $('a').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim() || "";

                if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                    try {
                        const fullUrl = new URL(href, rootUrl).href;
                        if (fullUrl.includes(domain)) {
                            allLinks.set(fullUrl, text);
                        }
                    } catch (e) { }
                }
            });

            // Step 3: Crawl key sub-pages that likely have portfolio links
            // Look for links like /real-estate/, /portfolio/, /investments/, /our-work/, etc.
            const keyPages = [];
            allLinks.forEach((text, linkUrl) => {
                const path = new URL(linkUrl).pathname.toLowerCase();
                if (
                    path.includes('real-estate') ||
                    path.includes('infrastructure') ||
                    path.includes('private-equity') ||
                    path.includes('portfolio') ||
                    path.includes('investments') ||
                    path.includes('our-work')
                ) {
                    keyPages.push(linkUrl);
                }
            });

            console.log(`🔍 Crawling ${keyPages.length} key sub-pages...`);
            for (const pageUrl of keyPages.slice(0, 5)) { // Limit to 5 sub-pages
                try {
                    const pageHtml = await this.fetchHtml(pageUrl);
                    const $$ = cheerio.load(pageHtml);
                    $$('a').each((i, el) => {
                        const href = $$(el).attr('href');
                        const text = $$(el).text().trim() || "";
                        if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                            try {
                                const fullUrl = new URL(href, pageUrl).href;
                                if (fullUrl.includes(domain)) {
                                    allLinks.set(fullUrl, text);
                                }
                            } catch (e) { }
                        }
                    });
                } catch (e) {
                    console.warn(`Failed to crawl ${pageUrl}: ${e.message}`);
                }
            }

            // Convert map to array for AI
            const links = Array.from(allLinks.entries()).map(([linkUrl, text]) => ({ url: linkUrl, text }));
            console.log(`📊 Total unique links found: ${links.length}`);

            // Ask AI to select relevant links
            const linkSelectionPrompt = `
                I am researching "${topic}" for the company at ${rootUrl}.
                Here are the links found on the website (including sitemap and sub-pages):
                ${JSON.stringify(links.slice(0, 500))}

                Select up to 20 URLs that are most likely to contain this information.
                Rank them by relevance score (0-100).
                
                Prioritize pages like:
                - Portfolio pages / Case Studies / Project pages
                - "Team" / "Leadership" / "People"
                - "Investments" / "Our Work"
                - "Strategy" / "Approach" / "Family Office"
                - "About Us" / "History"

                Return a strict JSON array of objects with keys: "url", "title" (cleaned up link text), "reason" (why you chose it), and "score" (number).
            `;

            const linkResult = await model.generateContent(linkSelectionPrompt);
            const selectedLinks = this.parseJson(linkResult.response.text());

            return {
                recommended: selectedLinks || [],
                all: links // Return all raw links so user can manually select others
            };

        } catch (e) {
            console.error('Scan failed:', e);
            throw new Error(`Scan failed: ${e.message}`);
        }
    }

    /**
     * Try to extract all URLs from sitemap.xml
     */
    static async extractSitemapUrls(rootUrl) {
        const sitemapPaths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'];

        for (const path of sitemapPaths) {
            try {
                const sitemapUrl = new URL(path, rootUrl).href;
                const xml = await this.fetchHtml(sitemapUrl);

                if (!xml.includes('<?xml') && !xml.includes('<urlset') && !xml.includes('<sitemapindex')) {
                    continue; // Not a valid sitemap
                }

                const urls = [];

                // Extract <loc> tags
                const locMatches = xml.match(/<loc>(.*?)<\/loc>/g);
                if (locMatches) {
                    for (const match of locMatches) { // Use for...of for await inside loop
                        const url = match.replace(/<\/?loc>/g, '').trim();

                        // If it's a sitemap index, recursively fetch child sitemaps
                        if (url.endsWith('.xml')) {
                            // Don't recurse too deep, just fetch this one sitemap
                            try {
                                const childXml = await this.fetchHtml(url);
                                const childLocs = childXml.match(/<loc>(.*?)<\/loc>/g);
                                if (childLocs) {
                                    childLocs.forEach(childMatch => {
                                        const childUrl = childMatch.replace(/<\/?loc>/g, '').trim();
                                        if (!childUrl.endsWith('.xml')) {
                                            urls.push(childUrl);
                                        }
                                    });
                                }
                            } catch (e) {
                                console.warn(`Failed to fetch child sitemap ${url}`);
                            }
                        } else {
                            urls.push(url);
                        }
                    }
                }

                return urls;
            } catch (e) {
                // Try next sitemap path
            }
        }

        return []; // No sitemap found
    }

    /**
     * Step 2: Deeply research specific URLs
     * @param {Array<string>} targetUrls - list of URLs to scrape
     * @param {string} topic - prompt from user
     */
    static async researchCompany(targetUrls, topic) {
        console.log(`🕵️‍♀️ Researching ${topic} on ${targetUrls.length} pages...`);

        try {
            // Scrape target pages and aggregate content
            let aggregatedContent = "";
            for (const target of targetUrls) {
                try {
                    const pageHtml = await this.fetchHtml(target);
                    // Simple text extraction - could be improved
                    const $$ = cheerio.load(pageHtml);
                    $$('script, style, nav, footer, svg, noscript').remove();

                    const text = $$('body').text().replace(/\s+/g, ' ').trim().substring(0, 15000);
                    aggregatedContent += `\n\n--- SOURCE: ${target} ---\n${text}`;
                } catch (e) {
                    console.error(`Failed to scrape ${target}: ${e.message}`);
                }
            }

            // Synthesize answer
            const synthesisPrompt = `
                You are a real estate investment analyst.
                
                USER GOAL: ${topic}
                
                SOURCE CONTENT:
                ${aggregatedContent}
                
                INSTRUCTIONS:
                - Extract specific facts, deals, numbers, or dates mentioned in the content.
                - If the content mentions specific properties (sq ft, location, value), include them.
                - Format the output as a clean Markdown report I can append to a company profile.
                - If you found nothing relevant, state that clearly but suggest what else was found.
            `;

            const finalResult = await model.generateContent(synthesisPrompt);
            return finalResult.response.text();

        } catch (e) {
            console.error('Research failed:', e);
            throw new Error(`Research failed: ${e.message}`);
        }
    }

    static async fetchHtml(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            if (!response.ok) {
                // If 403/401, throw specific error
                if (response.status === 403 || response.status === 401) {
                    throw new Error(`Access denied (${response.status}). The site may block scrapers.`);
                }
                throw new Error(`HTTP ${response.status}`);
            }
            return await response.text();
        } catch (e) {
            console.warn(`Failed to fetch ${url}:`, e.message);
            return ""; // Return empty string so partial failures don't kill the whole process
        }
    }

    static parseJson(text) {
        try {
            const match = text.match(/\[.*\]/s);
            if (match) return JSON.parse(match[0]);
            return null;
        } catch (e) { return null; }
    }
}
