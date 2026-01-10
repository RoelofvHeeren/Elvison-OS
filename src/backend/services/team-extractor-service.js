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
You are analyzing a company webpage to extract team member information.

Company: ${companyName}

Page Content:
${pageContent.substring(0, 15000)}

---

TASK: Extract all team members mentioned on this page.

For each person, provide:
1. name - Full name (required)
2. title - Job title/role (if mentioned)

OUTPUT FORMAT (JSON only, no markdown):
{
    "team_members": [
        {"name": "John Smith", "title": "CEO & Founder"},
        {"name": "Jane Doe", "title": "Director of Operations"}
    ]
}

RULES:
- Only include actual people who work at the company
- Ignore testimonials, quotes from external people, or news mentions
- If title is not clear, use "Unknown Role"
- Return empty array if no team members found

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
            console.log(`[TeamExtractor] Extracted ${members.length} team members`);
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
 * @returns {Promise<{companyProfile: string, teamMembers: Array}>}
 */
export async function researchCompanyTeam(url) {
    const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

    // 0. Preliminary Company Name extraction
    let companyName = domain.split('.')[0]
        .replace(/-/g, ' ')
        .replace(/properties|homes|group|inc|llc|ltd|co/gi, ' ')
        .trim()
        .replace(/\b\w/g, l => l.toUpperCase());

    // Add "Properties" back if it was part of the common name (optional optimization)
    if (domain.includes('properties')) companyName += " Properties";
    if (domain.includes('homes')) companyName += " Homes";

    console.log(`[TeamExtractor] Starting robust research for ${companyName} (${url})`);

    // 1. Find team pages (uses Google + Scan)
    const { teamPages, allLinks, homepageText, error } = await findTeamPages(url, companyName);

    // 2. Scrape team pages (or homepage if no team pages found)
    const pagesToScrape = teamPages.length > 0
        ? teamPages.slice(0, 5) // Limit to 5 pages
        : [`https://${domain}`]; // Fallback to homepage

    console.log(`[TeamExtractor] Scraping ${pagesToScrape.length} pages...`);

    const pageContent = await scrapeSpecificPages(pagesToScrape, process.env.APIFY_API_TOKEN);

    // 4. Extract team members
    let rawMembers = await extractTeamMembers(pageContent, companyName);

    // 5. Fallback: If no members found via scraping, try specialized Google search
    if (rawMembers.length === 0) {
        console.log(`[TeamExtractor] No members found via scraping. Trying specialized Google search...`);
        try {
            const { performGoogleSearch } = await import('./apify.js');
            const searchResults = await performGoogleSearch(`${companyName} team members leadership bios`, process.env.APIFY_API_TOKEN);
            const searchText = searchResults.map(r => `${r.title}\n${r.snippet}`).join('\n\n');

            if (searchText.length > 100) {
                console.log(`[TeamExtractor] Attempting extraction from search snippets...`);
                rawMembers = await extractTeamMembers(searchText, companyName);
            }
        } catch (e) {
            console.warn('[TeamExtractor] Search fallback failed:', e.message);
        }
    }

    // 6. Enrich with decision-maker flag
    const teamMembers = rawMembers.map(member => ({
        ...member,
        isDecisionMaker: isDecisionMaker(member.title),
        sourceUrl: teamPages[0] || `https://${domain}`,
        status: 'discovered'
    }));

    // Sort: Decision makers first
    teamMembers.sort((a, b) => (b.isDecisionMaker ? 1 : 0) - (a.isDecisionMaker ? 1 : 0));

    return {
        domain,
        companyName,
        teamMembers,
        pageCount: pagesToScrape.length,
        homepageText: homepageText?.substring(0, 2000) // For profile generation
    };
}

export default {
    findTeamPages,
    extractTeamMembers,
    researchCompanyTeam,
    isDecisionMaker
};
