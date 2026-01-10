/**
 * Team Extractor Service
 * Scrapes company websites to extract team members (names + titles)
 */
import { scanSiteStructure, scrapeSpecificPages } from './apify.js';
import { GeminiModel } from './gemini.js';

// Decision-maker keywords for title matching
const DECISION_MAKER_KEYWORDS = [
    'ceo', 'cfo', 'coo', 'cio', 'cto', 'chief',
    'president', 'founder', 'co-founder', 'owner',
    'partner', 'principal', 'director', 'managing',
    'head of', 'vp', 'vice president',
    'executive', 'chairman', 'chairwoman',
    'investor', 'associate', 'operations'
];

// Keywords that likely indicate a team/about page
const TEAM_PAGE_KEYWORDS = [
    'team', 'about', 'people', 'leadership', 'management',
    'executives', 'staff', 'our-team', 'who-we-are', 'meet-the-team'
];

/**
 * Check if a title indicates a decision-maker
 */
export function isDecisionMaker(title) {
    if (!title) return false;
    const lowerTitle = title.toLowerCase();
    return DECISION_MAKER_KEYWORDS.some(kw => lowerTitle.includes(kw));
}

/**
 * Find team-related pages on a website
 * @param {string} url - Company URL or domain
 * @param {string} companyName - Optional company name for better search
 * @returns {Promise<{teamPages: string[], allLinks: string[]}>}
 */
export async function findTeamPages(url, companyName = '') {
    const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
    const cleanCompanyName = companyName || domain.replace(/\..*$/, '').replace(/-/g, ' ');

    console.log(`[TeamExtractor] Scanning ${domain} for team pages...`);

    // 1. Concurrent checks: Local Scan + Google Search discovery
    const [structure, googleResults] = await Promise.all([
        scanSiteStructure(domain),
        import('./apify.js').then(m => m.performGoogleSearch(`site:${domain} team OR leadership OR people OR about`, process.env.APIFY_API_TOKEN))
    ]);

    let links = structure.links || [];

    // Add Google discovery links
    if (googleResults && googleResults.length > 0) {
        console.log(`[TeamExtractor] Google found ${googleResults.length} potential pages`);
        googleResults.forEach(r => {
            if (r.link && r.link.includes(domain)) {
                links.push(r.link);
            }
        });
    }

    // Fallback: If still no links found (SPA), try common paths
    if (links.length === 0) {
        console.log(`[TeamExtractor] No links found for ${domain}. Trying common paths...`);
        const commonPaths = ['/about', '/team', '/our-team', '/people', '/leadership', '/management', '/about-us'];
        links = commonPaths.map(path => `https://${domain}${path}`);
    }

    // Filter for team-related pages
    const teamPages = links.filter(link => {
        const lowerLink = link.toLowerCase();
        return TEAM_PAGE_KEYWORDS.some(kw => lowerLink.includes(kw));
    });

    // If the input URL was a specific page, add it to the top
    if (url.includes('/') && url.length > domain.length + 8) {
        if (!teamPages.find(p => p.includes(url))) {
            teamPages.unshift(url);
        }
    }

    console.log(`[TeamExtractor] Found ${teamPages.length} potential team pages after discovery`);

    return {
        teamPages: [...new Set(teamPages)],
        allLinks: [...new Set(links)],
        homepageText: structure.text,
        error: structure.error
    };
}

/**
 * Select the most relevant pages for team research using Gemini
 * @param {string} domain 
 * @param {string[]} links 
 * @returns {Promise<string[]>}
 */
async function selectRelevantPages(domain, links) {
    if (!links || links.length === 0) return [];

    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) return links.slice(0, 5);

    const gemini = new GeminiModel(apiKey, 'gemini-2.0-flash');

    const prompt = `
    I am analyzing the company at ${domain} to extract information about their leadership team.
    
    AVAILABLE PAGES:
    ${links.slice(0, 150).join('\n')}
    
    TASK: Select the Top 15 most relevant URLs that would likely contain:
    - Founder/CEO/Partner names and bios
    - Team/Leadership/Management overview
    - About Us / Company History
    - Portfolio / Partners / Track Record
    
    OUTPUT: Return ONLY a raw JSON object with a "urls" array.
    Example: {"urls": ["https://example.com/team", "https://example.com/about"]}
    `;

    try {
        const response = await gemini.getResponse({ input: prompt, temperature: 0 });
        const text = response.output?.find(o => o.type === 'message')?.content?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed.urls || [];
        }
    } catch (e) {
        console.warn(`[TeamExtractor] Smart selection failed:`, e.message);
    }
    return links.slice(0, 10);
}

/**
 * Extract team members from page content using Gemini
 * @param {string} pageContent - HTML/text content from team pages
 * @param {string} companyName - Company name for context
 * @returns {Promise<Array<{name: string, title: string, sourceUrl?: string}>>}
 */
export async function extractTeamMembers(pageContent, companyName) {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('[TeamExtractor] Missing GOOGLE_API_KEY');
        return [];
    }

    const gemini = new GeminiModel(apiKey, 'gemini-2.0-flash');

    const prompt = `
You are an expert researcher. Your task is to extract the LEADERSHIP TEAM and KEY DECISION MAKERS for the company: "${companyName}".

CONTEXT FROM WEBSITE:
${pageContent.substring(0, 30000)}

---

TASK: Extract all team members, prioritizing Founders, CEOs, Partners, and Managing Directors.

For each person, provide:
1. name - Full name (required)
2. title - Exact job title/role as mentioned
3. is_decision_maker - Boolean (true if they are Founder, CEO, Partner, Principal, or Director)

CRITICAL RULES:
- ONLY include people who are actual employees/leaders of ${companyName}.
- EXCLUDE partner companies, consultants, or service providers. (e.g. if you see "Our Partners: ACE Project Marketing", "ACE" is a company, NOT a person).
- EXCLUDE names of lawyers, architects, or designers from other firms listed as "Partners" or "Consultants".
- If the content mentions a "Founder" or "CEO" in the narrative (e.g., "Founded by John Doe"), extract them!
- If you are extracting from search snippets, ENSURE they are actually about ${companyName} and not a similarly named company.

OUTPUT FORMAT (JSON only):
{
    "team_members": [
        {"name": "...", "title": "...", "is_decision_maker": true}
    ]
}

JSON OUTPUT:`;

    try {
        const response = await gemini.getResponse({
            input: prompt,
            temperature: 0.1
        });

        const text = response.output?.find(o => o.type === 'message')?.content?.[0]?.text || '';

        // Parse JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const members = parsed.team_members || [];
            console.log(`[TeamExtractor] Extracted ${members.length} team members for ${companyName}`);
            return members;
        }

        return [];
    } catch (e) {
        console.error('[TeamExtractor] Extraction error:', e.message);
        return [];
    }
}

/**
 * Full pipeline: Find pages → Scrape → Extract team
 * @param {string} url - Company URL or domain (e.g., https://fifthavehomes.com/our-team/)
 * @param {function} onProgress - Callback for progress updates
 * @returns {Promise<{companyProfile: string, teamMembers: Array}>}
 */
export async function researchCompanyTeam(url, onProgress = () => { }) {
    const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

    // 0. Preliminary Company Name extraction
    let companyName = domain.split('.')[0]
        .replace(/-/g, ' ')
        .replace(/properties|homes|group|inc|llc|ltd|co/gi, ' ')
        .trim()
        .replace(/\b\w/g, l => l.toUpperCase());

    if (domain.includes('properties')) companyName += " Properties";
    if (domain.includes('homes')) companyName += " Homes";

    console.log(`[TeamExtractor] Starting robust research for ${companyName} (${url})`);
    onProgress('Scanning site structure...');

    // 1. Discovery: Homepage Scan + Sitemap
    const { teamPages: quickTeamPages, allLinks, homepageText, error } = await findTeamPages(url, companyName);

    // 2. Smart Selection: Let Gemini pick the best pages from the full site structure
    console.log(`[TeamExtractor] Discovered ${allLinks.length} total links. Selecting top pages...`);
    onProgress(`Analyzing ${allLinks.length} discovered links...`);
    const smartPages = await selectRelevantPages(domain, allLinks);

    // Prioritize explicitly found team pages and smart pages
    const pagesToScrape = [...new Set([
        url,
        ...quickTeamPages,
        ...smartPages
    ])].slice(0, 15); // Increase limit to 15 pages as requested

    console.log(`[TeamExtractor] Scraping ${pagesToScrape.length} target pages:`, pagesToScrape);
    onProgress(`Scraping ${pagesToScrape.length} relevant pages...`);

    // 3. Scrape all selected pages
    const pageContent = await scrapeSpecificPages(pagesToScrape, process.env.APIFY_API_TOKEN, (completed, total) => {
        onProgress(`Scraping page ${completed}/${total}...`);
    });

    // 4. Extract team members from combined content
    onProgress('Extracting team members...');
    let rawMembers = await extractTeamMembers(pageContent, companyName);

    // 5. Fallback: If no members found, try specialized Search with site constraint
    if (rawMembers.length === 0) {
        console.log(`[TeamExtractor] No members found via scraping. Trying site-constrained Search fallback...`);
        onProgress('Fallback: Searching Google for leadership...');
        try {
            const { performGoogleSearch } = await import('./apify.js');
            // FIX: Ensure domain is clean for site: operator
            const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
            const searchResults = await performGoogleSearch(`site:${cleanDomain} (team OR leadership OR founder OR principal)`, process.env.APIFY_API_TOKEN);
            const searchText = searchResults.map(r => `${r.title}\n${r.snippet}`).join('\n\n');

            if (searchText.length > 100) {
                console.log(`[TeamExtractor] Attempting extraction from search snippets...`);
                rawMembers = await extractTeamMembers(searchText, companyName);
            }
        } catch (e) {
            console.warn('[TeamExtractor] Search fallback failed:', e.message);
        }
    }

    // 6. Final Enrichment & Sorting
    const teamMembers = rawMembers.map(member => ({
        ...member,
        isDecisionMaker: member.is_decision_maker || isDecisionMaker(member.title),
        sourceUrl: pagesToScrape[0],
        status: 'discovered'
    }));

    teamMembers.sort((a, b) => (b.isDecisionMaker ? 1 : 0) - (a.isDecisionMaker ? 1 : 0));

    return {
        domain,
        companyName,
        teamMembers,
        pageCount: pagesToScrape.length,
        homepageText: homepageText?.substring(0, 2000)
    };
}

export default {
    findTeamPages,
    extractTeamMembers,
    researchCompanyTeam,
    isDecisionMaker
};
