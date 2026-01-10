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
    'executive', 'chairman', 'chairwoman'
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
 * @param {string} domain - Company domain
 * @returns {Promise<{teamPages: string[], allLinks: string[]}>}
 */
export async function findTeamPages(domain) {
    console.log(`[TeamExtractor] Scanning ${domain} for team pages...`);

    const structure = await scanSiteStructure(domain);

    if (structure.error) {
        console.warn(`[TeamExtractor] Scan error: ${structure.error}`);
        return { teamPages: [], allLinks: [], error: structure.error };
    }

    // Filter for team-related pages
    const teamPages = structure.links.filter(link => {
        const lowerLink = link.toLowerCase();
        return TEAM_PAGE_KEYWORDS.some(kw => lowerLink.includes(kw));
    });

    console.log(`[TeamExtractor] Found ${teamPages.length} potential team pages`);

    return {
        teamPages,
        allLinks: structure.links,
        homepageText: structure.text
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
 * @param {string} domain - Company domain (e.g., fifthaveproperties.com)
 * @returns {Promise<{companyProfile: string, teamMembers: Array}>}
 */
export async function researchCompanyTeam(domain) {
    console.log(`[TeamExtractor] Starting full research for ${domain}`);

    // 1. Find team pages
    const { teamPages, allLinks, homepageText, error } = await findTeamPages(domain);

    if (error) {
        return { error, teamMembers: [] };
    }

    // 2. Scrape team pages (or homepage if no team pages found)
    const pagesToScrape = teamPages.length > 0
        ? teamPages.slice(0, 5) // Limit to 5 pages
        : [`https://${domain}`]; // Fallback to homepage

    console.log(`[TeamExtractor] Scraping ${pagesToScrape.length} pages...`);

    const pageContent = await scrapeSpecificPages(pagesToScrape);

    // 3. Extract company name from domain
    const companyName = domain
        .replace(/\.(com|ca|org|net|io|co).*$/, '')
        .split('.')
        .pop()
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

    // 4. Extract team members
    const rawMembers = await extractTeamMembers(pageContent, companyName);

    // 5. Enrich with decision-maker flag
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
