
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
                try {
                    // Start with basic path title
                    const path = new URL(sitemapUrl).pathname;
                    let title = path.split('/').filter(Boolean).pop() || 'Page';

                    // Prettify: replace dashes/underscores, capitalize words
                    title = title.replace(/[-_]/g, ' ')
                        .replace(/\b\w/g, c => c.toUpperCase());

                    // If title is too simple or numeric, try parent folder
                    if (title.length < 3 || /^\d+$/.test(title)) {
                        const parts = path.split('/').filter(Boolean);
                        if (parts.length > 1) {
                            title = parts[parts.length - 2].replace(/[-_]/g, ' ') + ' - ' + title;
                        }
                    }

                    allLinks.set(sitemapUrl, title);
                } catch (e) {
                    console.warn(`Skipping invalid sitemap URL: ${sitemapUrl}`);
                }
            });

            // Step 2: Crawl homepage
            console.log('🏠 Crawling homepage...');
            const html = await this.fetchHtml(rootUrl);
            const $ = cheerio.load(html);

            $('a').each((i, el) => {
                const href = $(el).attr('href');
                let text = $(el).text().trim();
                const titleAttr = $(el).attr('title');

                // Keep image alt text if no text provided
                if (!text) {
                    const imgAlt = $(el).find('img').attr('alt');
                    if (imgAlt) text = `Image: ${imgAlt}`;
                }

                // Prioritize title attribute if text is weak (e.g. "Read more")
                if (titleAttr && (!text || text.toLowerCase() === 'read more')) {
                    text = titleAttr;
                }

                if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                    try {
                        const fullUrl = new URL(href, rootUrl).href;
                        if (fullUrl.includes(domain)) {
                            // If we already have a link, keep the longer text as it's likely more descriptive
                            const existing = allLinks.get(fullUrl);
                            if (!existing || (text && text.length > existing.length && text.length < 100)) {
                                allLinks.set(fullUrl, text || fullUrl); // Fallback to URL if still empty
                            }
                        }
                    } catch (e) { }
                }
            });

            // Step 3: Crawl key sub-pages that likely have portfolio links
            // Look for links like /real-estate/, /portfolio/, /investments/, /our-work/, etc.
            const keyPages = [];
            allLinks.forEach((text, linkUrl) => {
                try {
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
                } catch (e) {
                    console.warn(`Skipping invalid link: ${linkUrl}`);
                }
            });

            console.log(`🔍 Crawling ${keyPages.length} key sub-pages...`);
            for (const pageUrl of keyPages.slice(0, 5)) { // Limit to 5 sub-pages
                try {
                    const pageHtml = await this.fetchHtml(pageUrl);
                    const $$ = cheerio.load(pageHtml);
                    $$('a').each((i, el) => {
                        const href = $$(el).attr('href');
                        let text = $$(el).text().trim();
                        const titleAttr = $$(el).attr('title');

                        if (!text) {
                            const imgAlt = $$(el).find('img').attr('alt');
                            if (imgAlt) text = `Image: ${imgAlt}`;
                        }

                        if (titleAttr && (!text || text.toLowerCase() === 'read more')) {
                            text = titleAttr;
                        }

                        if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
                            try {
                                const fullUrl = new URL(href, pageUrl).href;
                                if (fullUrl.includes(domain)) {
                                    // If we already have a link, keep the longer text as it's likely more descriptive
                                    const existing = allLinks.get(fullUrl);
                                    if (!existing || (text && text.length > existing.length && text.length < 100)) {
                                        allLinks.set(fullUrl, text || fullUrl);
                                    }
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

            // Step 1: Auto-select URLs matching portfolio patterns (these are almost always relevant)
            const portfolioPatterns = [
                '/investment_portfolio/',
                '/portfolio/',
                '/projects/',
                '/case-studies/',
                '/case_studies/',
                '/our-work/',
                '/transactions/',
                '/deals/'
            ];

            const autoSelected = links.filter(link => {
                const urlLower = link.url.toLowerCase();
                return portfolioPatterns.some(pattern => urlLower.includes(pattern));
            }).map(link => ({
                url: link.url,
                title: link.text || link.url.split('/').filter(Boolean).pop()?.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Portfolio Page',
                reason: 'Auto-selected: URL pattern indicates portfolio/project page',
                score: 100
            }));

            console.log(`🎯 Auto-selected ${autoSelected.length} portfolio pages`);

            // Step 2: Ask AI to select additional relevant links (excluding auto-selected ones)
            const autoSelectedUrls = new Set(autoSelected.map(l => l.url));
            const remainingLinks = links.filter(l => !autoSelectedUrls.has(l.url));

            const linkSelectionPrompt = `
                I am researching "${topic}" for the company at ${rootUrl}.
                Here are the links found on the website (portfolio pages already selected):
                ${JSON.stringify(remainingLinks.slice(0, 500))}

                Select up to 30 additional URLs that are most likely to contain this information.
                Rank them by relevance score (0-100).
                
                Prioritize pages like:
                - "Team" / "Leadership" / "People"
                - "Investments" / "Strategy" / "Approach"
                - "About Us" / "History" / "News"
                - Specific deal announcements or press releases

                Return a strict JSON array of objects with keys: "url", "title" (cleaned up link text), "reason" (why you chose it), and "score" (number).
            `;

            const linkResult = await model.generateContent(linkSelectionPrompt);
            const aiSelectedLinks = this.parseJson(linkResult.response.text()) || [];

            // Combine auto-selected + AI-selected
            const selectedLinks = [...autoSelected, ...aiSelectedLinks];

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
    static async researchCompany(targetUrls, topic, onProgress = () => { }) {
        console.log(`🕵️‍♀️ Researching ${topic} on ${targetUrls.length} pages...`);

        try {
            // Scrape target pages and aggregate content
            let aggregatedContent = "";
            let scrapedCount = 0;
            for (const target of targetUrls) {
                onProgress(`Scraping page ${scrapedCount + 1}/${targetUrls.length}: ${new URL(target).hostname}...`);
                scrapedCount++;
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
            onProgress('Synthesizing research report...');
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
            console.error('Deep research failed:', e);
            throw new Error(`Research failed: ${e.message}`);
        }
    }

    /**
     * Merge new research with existing company profile using AI
     */
    static async mergeProfiles(existingProfile, newResearch) {
        if (!existingProfile || existingProfile.trim().length === 0) {
            return newResearch; // No existing profile, just return new research
        }

        try {
            const mergePrompt = `
                You are updating a company profile with new research findings.
                
                **Existing Profile:**
                ${existingProfile}
                
                **New Research:**
                ${newResearch}
                
                **Task:**
                Intelligently merge these two profiles into one comprehensive report.
                - Preserve ALL unique information from both sources
                - Remove duplicates and redundancies
                - If new research has more specific/detailed information, use that instead of older vague info
                - Maintain the markdown structure and section organization
                - Prioritize recent information over old when there are conflicts
                - Keep the combined profile well-organized and scannable
                
                Return ONLY the merged markdown profile, no preamble.
            `;

            const result = await model.generateContent(mergePrompt);
            return result.response.text();
        } catch (e) {
            console.error('Profile merge failed:', e);
            // Fallback: concatenate with a separator
            return `${existingProfile}\n\n---\n\n## Updated Research\n\n${newResearch}`;
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

    /**
     * Generate a company profile from raw text content
     * Used for manual company research where we already have scraped content
     * @param {string} textContent - Raw text from website
     * @param {string} researchTopic - Optional focus for the profile
     * @returns {Promise<string>} - Formatted company profile
     */
    static async generateProfileFromText(textContent, researchTopic = '') {
        if (!textContent || textContent.trim().length < 50) {
            return 'Insufficient content to generate profile.';
        }

        try {
            const prompt = `
                You are a business analyst generating a company profile.
                
                ${researchTopic ? `RESEARCH FOCUS: ${researchTopic}` : ''}
                
                SOURCE CONTENT (from company website):
                ${textContent.substring(0, 20000)}
                
                INSTRUCTIONS:
                Generate a structured company profile with the following sections:
                
                **Summary** - Brief overview of what the company does
                **Investment Strategy** - If applicable, their investment focus/thesis
                **Scale & Geographic Focus** - Size, locations, markets they operate in
                **Key Highlights** - Notable facts, achievements, differentiators
                **Fit Analysis** - Potential for partnership/outreach (if context is available)
                
                Format as clean markdown. If a section lacks content, omit it.
                Be concise but capture all key facts.
            `;

            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (e) {
            console.error('Profile generation failed:', e);
            return `Unable to generate profile: ${e.message}`;
        }
    }
    /**
     * Run a Full Site Scan using Apify
     * @param {string} url - Website URL
     * @param {string} token - Apify API Token
     * @param {number} maxCost - Max cost in USD (default 5.00)
     * @param {Function} onProgress - Callback for progress updates
     */
    static async runFullSiteScan(url, token, maxCost = 5.00, onProgress) {
        // Import here to avoid circular dependencies if any
        const { scrapeFullSite } = await import('./apify.js');

        let domain = url;
        try {
            domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
        } catch (e) {
            // keep as is
        }

        return await scrapeFullSite(domain, token, maxCost, onProgress);
    }

    static async synthesizeFullScanReport(items, companyName, onProgress = () => { }) {
        if (!items || items.length === 0) return "No content scraped to analyze.";

        // --- BATCHED ANALYSIS PHASE ---
        const BATCH_SIZE = 200; // 200 pages at a time
        const batches = [];
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            batches.push(items.slice(i, i + BATCH_SIZE));
        }

        console.log(`🧠 Batched Analysis: Processing ${items.length} pages in ${batches.length} batches...`);
        const partialSummaries = [];

        for (let i = 0; i < batches.length; i++) {
            onProgress(`Analyzing Batch ${i + 1}/${batches.length}...`);
            const chunk = batches[i];

            // Limit each batch's text to stay under Gemini token limits (~3MB per batch is very safe for 1.5/2.0)
            const chunkText = chunk.map(p => `--- URL: ${p.url} ---\n${p.markdown || p.text || ''}`).join('\n\n').substring(0, 3000000);

            const extractionPrompt = `
                ACT AS: Expert Investment Analyst
                TARGET: ${companyName}
                
                I am providing a batch of ${chunk.length} pages from their website.
                EXTRACT all key facts regarding:
                - Business Model & Core Services
                - Target Asset Classes (Residential, Commercial, etc.)
                - Geographic footprint (specifically Canada/Ontario)
                - Notable projects or recent deals
                - Key Executives mentioned
                - Any explicit mention of "Real Estate Development" or "Investment"

                Be as dense and factual as possible. Do NOT write the final report yet, just extract the evidence.
                --- WEBSITE DATA (BATCH ${i + 1}) ---
                ${chunkText}
            `;

            try {
                const response = await model.generateContent(extractionPrompt);
                partialSummaries.push(response.response.text());
                console.log(`✅ Batch ${i + 1}/${batches.length} complete.`);
            } catch (e) {
                console.error(`❌ Batch ${i + 1} failed:`, e.message);
                partialSummaries.push(`[Batch ${i + 1} Error: Failed to extract data due to ${e.message}]`);
            }
        }

        // --- FINAL MASTER SYNTHESIS ---
        onProgress(`Finalizing Intelligence Report...`);
        const finalPrompt = `
            You are an expert investment analyst working for a **Canadian Residential Real Estate Developer**.
            Your task is to synthesize the following batched evidence into a concise, high-value **Company Intelligence Report** for "${companyName}".

            **Context**:
            We are looking for potential partners or acquisition opportunities in Canadian residential real estate.

            **Extracted Evidence**:
            ---
            ${partialSummaries.join('\n\n---\n\n')}
            ---

            **Instructions**:
            1. Consolidate facts. Remove redundancy.
            2. Prioritize evidence related to Canada and Residential Development.
            3. Use the following structure:

            # [Company Name]
            
            ## Summary
            (2-3 sentences max)

            ## Investment Strategy & Focus
            (Bullet points on asset classes, strategies, and development/lending mix)

            ## Scale & Geographic Focus
            (Where they operate and current estimated portfolio size/reach)

            ## Portfolio Observations
            (Specific project highlights or deal types)

            ## Key Team Members
            (Names and titles if found)

            ## Fit Analysis
            (CRITICAL: Evaluate as High/Medium/Low fit for a Canadian Residential Developer. Explain why.)

            IMPORTANT: Be extremely concise. Use bullet points. If data is missing across all batches, state "Not available".
        `;

        const finalResult = await model.generateContent(finalPrompt);
        return finalResult.response.text();
    }
}
