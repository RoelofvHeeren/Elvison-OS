
import * as cheerio from 'cheerio';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

export class ResearchService {

    /**
     * Deeply research a specific topic for a company.
     * @param {string} url - base website URL
     * @param {string} topic - prompt from user (e.g. "Find deal history")
     */
    static async researchCompany(url, topic) {
        console.log(`🕵️‍♀️ Researching ${topic} for ${url}...`);

        // 1. Fetch homepage to find relevant links
        let rootUrl = url;
        if (!rootUrl.startsWith('http')) rootUrl = 'https://' + rootUrl;

        try {
            const html = await this.fetchHtml(rootUrl);
            const $ = cheerio.load(html);

            // Extract all links
            const links = [];
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                    // Resolve relative URLs
                    try {
                        const fullUrl = new URL(href, rootUrl).href;
                        if (fullUrl.includes(new URL(rootUrl).hostname)) {
                            links.push({ text: $(el).text().trim(), url: fullUrl });
                        }
                    } catch (e) { }
                }
            });

            // 2. Ask AI which links are most relevant to the topic
            const linkSelectionPrompt = `
                I need to find information about "${topic}" for the company at ${rootUrl}.
                Here are the links found on the homepage:
                ${JSON.stringify(links.slice(0, 50))} // Limit to 50 links to save context

                Return a JSON array of the top 3 URLs that are most likely to contain this information.
                Format: ["url1", "url2", "url3"]
            `;

            const linkResult = await model.generateContent(linkSelectionPrompt);
            const linkJson = this.parseJson(linkResult.response.text());
            const targetUrls = linkJson || [rootUrl]; // Fallback to root if fails

            console.log(`🔗 Scraper targeting:`, targetUrls);

            // 3. Scrape target pages and aggregate content
            let aggregatedContent = "";
            for (const target of targetUrls) {
                try {
                    const pageHtml = await this.fetchHtml(target);
                    const $$ = cheerio.load(pageHtml);
                    // Remove scripts, styles
                    $$('script').remove();
                    $$('style').remove();
                    $$('nav').remove();
                    $$('footer').remove();

                    const text = $$('body').text().replace(/\s+/g, ' ').substring(0, 10000); // Limit context
                    aggregatedContent += `\n\n--- SOURCE: ${target} ---\n${text}`;
                } catch (e) {
                    console.error(`Failed to scrape ${target}: ${e.message}`);
                }
            }

            // 4. Synthesize answer
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
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
    }

    static parseJson(text) {
        try {
            const match = text.match(/\[.*\]/s);
            if (match) return JSON.parse(match[0]);
            return null;
        } catch (e) { return null; }
    }
}
