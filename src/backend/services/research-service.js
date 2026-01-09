
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export class ResearchService {

    /**
     * Step 1: Scan a company website for relevant pages (Sitemap/Links)
     * @param {string} url - base website URL
     * @param {string} topic - research topic to filter links
     * @returns {Promise<Array<{url: string, title: string, reason: string}>>}
     */
    static async scanCompany(url, topic) {
        console.log(`🕵️‍♀️ Scanning ${url} for topic: ${topic}...`);

        let rootUrl = url;
        if (!rootUrl.startsWith('http')) rootUrl = 'https://' + rootUrl;

        try {
            const html = await this.fetchHtml(rootUrl);
            const $ = cheerio.load(html);

            // Extract all unique links
            const uniqueLinks = new Map();
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim() || "Link";

                if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                    try {
                        const fullUrl = new URL(href, rootUrl).href;
                        // Only internal links
                        if (fullUrl.includes(new URL(rootUrl).hostname)) {
                            uniqueLinks.set(fullUrl, text);
                        }
                    } catch (e) { }
                }
            });

            // Convert map to array for AI
            const links = Array.from(uniqueLinks.entries()).map(([linkUrl, text]) => ({ url: linkUrl, text }));

            // Ask AI to select relevant links
            const linkSelectionPrompt = `
                I am researching "${topic}" for the company at ${rootUrl}.
                Here are the links found on the homepage:
                ${JSON.stringify(links.slice(0, 200))}

                Select up to 20 URLs that are most likely to contain this information.
                Prioritize pages like:
                - "Team" / "Leadership" / "People"
                - "Portfolio" / "Investments" / "Case Studies"
                - "Strategy" / "Approach" / "Family Office"
                - "About Us" / "History"

                Return a strict JSON array of objects with keys: "url", "title" (cleaned up link text), and "reason" (why you chose it).
            `;

            const linkResult = await model.generateContent(linkSelectionPrompt);
            const selectedLinks = this.parseJson(linkResult.response.text());

            return selectedLinks || [{ url: rootUrl, title: "Homepage", reason: "Fallback" }];

        } catch (e) {
            console.error('Scan failed:', e);
            throw new Error(`Scan failed: ${e.message}`);
        }
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
