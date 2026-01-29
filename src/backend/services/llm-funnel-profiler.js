import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);

/**
 * LLM Funnel Profiler Service
 * Replaces fixed scoring with intelligent 3-stage funnel:
 * 1. Filter relevant pages from sitemap (LLM)
 * 2. Scrape selected pages (Apify)
 * 3. Extract structured facts & generate profile (LLM)
 */
const LLMFunnelProfiler = {

    /**
     * STAGE 1: Filter Sitemap Links
     * Uses Gemini Flash to select only pages relevant for investment focus/portfolio
     */
    async filterRelevantPages(sitemapLinks, companyName, icpType) {
        if (!sitemapLinks || sitemapLinks.length === 0) return [];

        console.log(`[LLMFunnel] Filtering ${sitemapLinks.length} links for ${companyName}...`);

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.3,
                    responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            relevant_urls: {
                                type: SchemaType.ARRAY,
                                items: { type: SchemaType.STRING }
                            },
                        },
                        required: ['relevant_urls']
                    }
                }
            });

            const chunks = [];
            for (let i = 0; i < sitemapLinks.length; i += 500) {
                chunks.push(sitemapLinks.slice(i, i + 500));
            }

            let allRelevantUrls = [];

            for (const chunk of chunks) {
                const prompt = `
                You are analyzing a sitemap for a real estate investment company to identify pages relevant for outreach research.

                COMPANY: ${companyName}
                ICP TYPE: ${icpType}

                GOAL: Select ALL pages that might contain information about:
                1. Investment thesis, strategy, focus areas, or criteria
                2. Portfolio companies, real estate projects, or past transactions
                3. Specific deals, acquisitions, developments, or assets under management
                4. Recent news about investments or projects
                5. Geographic focus (regional pages like /canada/, /us/, etc.)

                INSTRUCTIONS:
                - Be LENIENT - include pages if there's any chance they contain relevant info
                - Prioritize navigation hubs (e.g., "Services", "Real Estate", "Investments") that might list sub-pages
                - Look for "One Pagers", "Performance Reports", "Brochures" (PDFs are high value)
                - Prioritize portfolio, projects, transactions, deals, investments pages
                - Include geographic sub-pages (e.g., /canada/portfolio, /us/projects)
                - EXCLUDE: careers, legal, privacy, login, media downloads, press releases (unless about specific deals)
                - Return up to 50 most relevant URLs from this list

                SITEMAP LINKS:
                ${chunk.join('\n')}

                Return a JSON array of the most relevant URLs.
                `;

                const result = await model.generateContent(prompt);
                const response = JSON.parse(result.response.text());
                allRelevantUrls = [...allRelevantUrls, ...(response.relevant_urls || [])];
            }

            const uniqueUrls = [...new Set(allRelevantUrls)];
            console.log(`[LLMFunnel] Selected ${uniqueUrls.length} relevant pages.`);
            return uniqueUrls.slice(0, 100);

        } catch (error) {
            console.error('[LLMFunnel] Error filtering pages:', error);
            return this._fallbackRegexFilter(sitemapLinks);
        }
    },

    /**
     * STAGE 1A: Pick Identity Pages
     * Slices the sitemap down to ONLY the 5-7 pages needed for qualification decision.
     */
    async filterIdentityPages(allLinks, companyName, icpType) {
        if (!allLinks || allLinks.length === 0) return [];
        console.log(`[LLMFunnel] Selecting identity pages (10 page quota) from ${allLinks.length} links...`);

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { responseMimeType: 'application/json' }
            });

            const prompt = `
            Analyze these URLs and pick 10 specific pages that are MOST essential for QUALIFYING if this company is a legitimate Real Estate Investor (REIT, Private Equity, or Family Office).
            
            We need a ROBUST understanding. Do not just pick the homepage or one 'About' page. Pick 10 that together tell the full story.
            
            TARGET PAGES:
            - IDENTITY: /about, /who-we-are, /history, /team, /leadership
            - STRATEGY: /strategy, /investment-thesis, /focus, /philosophy, /approach
            - SERVICES: /services, /platform, /what-we-do (look for capital deployment signals)
            - PROOF: /investments, /portfolio, /transactions (even if deep links exist, include the main hub)
            - NEWS: /news, /press, /insights (recent activity)
            
            COMPANY: ${companyName}
            ICP TYPE: ${icpType}
            
            LINKS:
            ${allLinks.slice(0, 300).join('\n')}
            
            Return JSON: { "identity_urls": ["url1", "url2", ..., "url10"] }
            `;

            const result = await model.generateContent(prompt);
            const response = JSON.parse(result.response.text());
            const urls = (response.identity_urls || []).slice(0, 12);

            console.log(`[LLMFunnel] Selected ${urls.length} identity pages for robust verification.`);
            return urls;

        } catch (error) {
            console.error('[LLMFunnel] Identity filtering failed:', error);
            return allLinks.filter(l => /about|strategy|who|focus|team|invest/i.test(l)).slice(0, 10);
        }
    },

    /**
     * STAGE 1B: High-Precision Qualification Reasoning
     * Decides if we should bother doing the full Deep Audit.
     */
    async qualifyCompany(identityContent, companyName, icpType) {
        if (!identityContent || identityContent.length < 200) return { is_qualified: false, reason: "Insufficient content for qualification" };

        console.log(`[LLMFunnel] Reasoning on qualification for ${companyName}...`);

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { responseMimeType: 'application/json' }
            });

            const prompt = `
            You are a strict Deal Origination Analyst. Your job is to decide if we should do a Deep Audit on this company for potential partnership.
            
            TARGET ICP: ${icpType} (Specifically Real Estate Investors)
            
            QUALIFICATION RULES:
            1. MUST be the PRINCIPAL, OWNER, or INVESTOR of real estate assets, OR manage a dedicated Real Estate / Private Equity fund.
            2. HYBRID FIRMS (Wealth Manager + RE Fund): These are a PASS. If they mention "Private Capital", "Real Estate Fund", or "Direct Assets", keep them.
            3. REJECT: Pure Retail Brokers, Law Firms, Tax Advisors, or small independent "Financial Planners".
            4. REJECT: Companies that only offer "Stock Portfolio Management" without any Real Estate signals.
            
            COMPANY NAME: ${companyName}
            
            CONSOLIDATED CONTENT:
            ${identityContent.substring(0, 40000)}
            
            Return JSON:
            {
                "is_qualified": boolean,
                "reason": "Detailed reasoning explaining why they are or are not a fit.",
                "confidence": 0.0 - 1.0,
                "entity_type": "FAMILY_OFFICE | REIT | PE | WEALTH_MANAGER | BROKER | OTHER"
            }
            `;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text().replace(/```json|```/g, '').trim();
            console.log(`[LLMFunnel] Qualification Raw Response for ${companyName}: ${responseText}`);
            let response = JSON.parse(responseText);

            // Unwrap array if needed
            if (Array.isArray(response)) response = response[0];

            // Normalize response keys just in case
            return {
                is_qualified: response.is_qualified ?? true,
                reason: response.reason || response.fit_reason || "No reason provided",
                confidence: response.confidence ?? 0.8,
                entity_type: response.entity_type || "UNKNOWN"
            };

        } catch (error) {
            console.error('[LLMFunnel] Qualification reasoning failed:', error);
            return { is_qualified: true, reason: "Fallback: Exception during reasoning", confidence: 0.5 };
        }
    },

    /**
     * STAGE 2A: Extract Outreach Facts
     * Extracts structured investment thesis and portfolio deals
     */
    async extractOutreachFacts(scrapedContent, companyName, icpType) {
        if (!scrapedContent || scrapedContent.length < 500) return null;

        console.log(`[LLMFunnel] Extracting outreach facts for ${companyName} from ${scrapedContent.length} chars...`);

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.2
                }
            });

            const cleanedContent = scrapedContent
                .replace(/(Facebook|LinkedIn|Instagram|Twitter|Threads|Login|Meet With Us|Cookie Settings|Cookie Policy|Privacy Policy|Terms of Use)/gi, '')
                .replace(/\[\s*image\s*\]/gi, '')
                .replace(/\s+/g, ' ')
                .slice(0, 500000);

            console.log(`[LLMFunnel] Passing ${cleanedContent.length} cleaned chars to LLM... (internal links preserved)`);

            const prompt = `
            Analyze this company data for outreach preparation.
            
            COMPANY: ${companyName}
            ICP TYPE: ${icpType}

            GOALS:
            1. INVESTMENT THESIS: Extract a 1-2 sentence core investment strategy.
            2. PORTFOLIO DEALS: Find specific REAL ESTATE PROJECTS or PROPERTY ACQUISITIONS.
            3. MANAGED FUNDS: List the specialized funds or internal LPs.
            4. KEY DOCUMENTS: Summarize any PDFs, Reports, or One Pagers.
            5. CRITERIA FOCUS: Extract specific investment criteria.
            
            JSON OUTPUT STRUCTURE:
            {
                "investment_thesis": "string",
                "portfolio_deals": [{"name": "string", "location": "string", "units": "string", "asset_class": "string"}],
                "managed_funds": ["string"],
                "key_documents": ["string"],
                "criteria_focus": "string"
            }

            SCRAPED CONTENT:
            ${cleanedContent}
            `;

            const result = await model.generateContent(prompt);
            const responseText = result.response.text().replace(/```json|```/g, '').trim();
            let response = JSON.parse(responseText);

            // Robust unwrapping
            if (Array.isArray(response)) response = response[0];
            if (response.GOALS) response = response.GOALS;
            if (response.data) response = response.data;

            const getValue = (keys, requiredType = null) => {
                for (const k of Object.keys(response)) {
                    const normK = k.toUpperCase().replace(/[^A-Z]/g, '');
                    for (const target of keys) {
                        if (normK.includes(target.replace(/[^A-Z]/g, ''))) {
                            const val = response[k];
                            if (requiredType === 'array' && !Array.isArray(val)) continue;
                            if (requiredType === 'string' && typeof val !== 'string') continue;
                            return val;
                        }
                    }
                }
                return undefined;
            };

            const deals = getValue(['PORTFOLIO DEALS', 'portfolio_deals'], 'array') || [];
            console.log(`[LLMFunnel] Extracted ${deals.length} deals.`);

            return {
                investment_thesis: getValue(['INVESTMENT THESIS', 'investment_thesis'], 'string') || "",
                portfolio_deals: deals,
                managed_funds: getValue(['MANAGED FUNDS', 'managed_funds'], 'array') || [],
                key_documents: getValue(['KEY DOCUMENTS', 'key_documents']) || [],
                criteria_focus: getValue(['CRITERIA FOCUS', 'criteria_focus']) || ""
            };

        } catch (error) {
            console.error('[LLMFunnel] Error extracting facts:', error);
            return null;
        }
    },

    /**
     * STAGE 2B: Generate Company Profile
     */
    async generateCompanyProfile(scrapedContent, companyName, icpType) {
        if (!scrapedContent || scrapedContent.length < 500) return null;

        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { temperature: 0.4 }
            });

            const cleanedContent = scrapedContent
                .replace(/(Facebook|LinkedIn|Instagram|Twitter|Threads|Login|Meet With Us|Cookie Settings|Cookie Policy|Privacy Policy|Terms of Use)/gi, '')
                .replace(/\[\s*image\s*\]/gi, '')
                .replace(/\s+/g, ' ')
                .slice(0, 500000);

            const prompt = `
            Write a detailed 1000-word company profile for research.
            
            COMPANY: ${companyName}
            ICP TYPE: ${icpType}
            
            CONTENT:
            ${cleanedContent}
            `;

            const result = await model.generateContent(prompt);
            return result.response.text();

        } catch (error) {
            console.error('[LLMFunnel] Error generating profile:', error);
            return null;
        }
    },

    _fallbackRegexFilter(links) {
        const patterns = [/portfolio|projects|properties|assets|deals/i, /strategy|focus|criteria/i, /about|company/i];
        return links.filter(l => patterns.some(p => p.test(l))).slice(0, 20);
    },

    async selectDiscoveryHubs(links, companyName) {
        if (!links || links.length === 0) return [];
        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { responseMimeType: 'application/json' }
            });

            const prompt = `Select up to 5 "Hub" pages from these links of ${companyName}:\n${links.slice(0, 50).join('\n')}`;
            const result = await model.generateContent(prompt);
            const response = JSON.parse(result.response.text());
            return (response.hubs || []).slice(0, 5);
        } catch (error) {
            return links.filter(l => /portfolio|project|invest/i.test(l)).slice(0, 5);
        }
    },

    async discoverPagesViaSearch(domain, companyName) {
        try {
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                tools: [{ googleSearch: {} }]
            });

            const prompt = `Find key URLs on "${domain}" for ${companyName} research. Return JSON { "relevant_urls": [...] }`;
            const result = await model.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            const response = JSON.parse(jsonMatch[0]);
            return (response.relevant_urls || []).slice(0, 10);
        } catch (error) {
            return [];
        }
    }
};

export default LLMFunnelProfiler;
