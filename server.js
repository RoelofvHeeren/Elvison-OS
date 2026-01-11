import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import cookieParser from 'cookie-parser'
import bcrypt from 'bcryptjs'
import { query, pool } from './db/index.js'
import { runAgentWorkflow } from './src/backend/workflow.js'
import { generateToken } from './src/backend/session-utils.js'
import { requireAuth, optionalAuth } from './src/backend/auth-middleware.js'
import path from 'path'
import { fileURLToPath } from 'url'
import { OptimizationService } from './src/backend/optimizer.js'
import { enrichLeadWithPhone } from './src/backend/workflow.js'
import multer from 'multer'
import { parse } from 'csv-parse/sync'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001

// CORS configuration to allow credentials
app.use(cors({
    origin: process.env.VITE_API_BASE_URL || 'http://localhost:5173',
    credentials: true
}))
app.use(express.json())
app.use(cookieParser())

// --- Static Files ---
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(express.static(path.join(__dirname, 'dist')))

// --- API Endpoints ---

// Health Check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Connectivity Test
app.get('/api/test/gemini', async (req, res) => {
    try {
        const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!key) return res.status(400).json({ error: "Missing GOOGLE_API_KEY" });

        const sanitizedKey = key.trim().replace(/[\s\r\n\t]/g, '');
        const google = (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: sanitizedKey });
        const { text } = await (await import('ai')).generateText({
            model: google('gemini-2.0-flash'),
            prompt: 'Say "Gemini is connected!"',
        });
        res.json({ success: true, response: text, keySignature: `${sanitizedKey.substring(0, 7)}...${sanitizedKey.substring(sanitizedKey.length - 4)}` });
    } catch (e) {
        res.status(500).json({ error: e.message, data: e.data });
    }
});

// TEMP: Cleanup Endpoint
app.post('/api/admin/cleanup', async (req, res) => {
    try {
        console.log('Starting cleanup...');

        // 1. Delete Blackstone leads with missing outreach
        const blackstoneRes = await query(`
            DELETE FROM leads 
            WHERE company_name ILIKE '%blackstone%' 
            AND (outreach_status IS NULL OR outreach_status = 'failed_generation')
            RETURNING id;
        `);

        // 2. Delete obvious bad titles created in last 24h
        const badKeywords = [
            'intern', 'student', 'assistant', 'coordinator', 'hr', 'human resources',
            'talent', 'recruiting', 'events', 'operations', 'cybersecurity',
            'technician', 'support', 'administrative', 'admin', 'clerk'
        ];

        const titleConditions = badKeywords.map(k => `title ILIKE '%${k}%'`).join(' OR ');

        const badTitleRes = await query(`
            DELETE FROM leads 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            AND (${titleConditions})
            returning id;
        `);

        res.json({
            success: true,
            deletedBlackstone: blackstoneRes.rowCount,
            deletedBadTitles: badTitleRes.rowCount,
            message: `Cleaned ${blackstoneRes.rowCount} Blackstone leads and ${badTitleRes.rowCount} bad title leads.`
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// COMPREHENSIVE DEEP CLEANUP - Manual verification of all companies
app.post('/api/admin/deep-cleanup', requireAuth, async (req, res) => {
    // SSE for streaming progress
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        const userId = req.userId;
        send({ type: 'status', message: 'Starting deep cleanup...' });

        // 1. Get all ICPs
        const { rows: icps } = await query('SELECT id, name FROM icps WHERE user_id = $1', [userId]);
        const familyOfficeIcp = icps.find(i => i.name.toLowerCase().includes('family office'));
        const investmentFundIcp = icps.find(i => i.name.toLowerCase().includes('fund') || i.name.toLowerCase().includes('investment firm'));

        send({ type: 'icps', familyOffice: familyOfficeIcp?.name, investmentFund: investmentFundIcp?.name });

        // 2. Get ALL companies with their profiles
        const { rows: companies } = await query(`
            SELECT 
                c.id, 
                c.company_name, 
                c.website, 
                c.company_profile,
                c.fit_score,
                c.user_id,
                (SELECT icp_id FROM leads WHERE company_name = c.company_name AND user_id = c.user_id LIMIT 1) as current_icp_id
            FROM companies c
            WHERE c.user_id = $1
            ORDER BY c.company_name
        `, [userId]);

        send({ type: 'status', message: `Found ${companies.length} companies to process` });

        const results = {
            total: companies.length,
            processed: 0,
            kept: 0,
            deleted: 0,
            rescored: 0,
            recategorized: 0,
            scraped: 0,
            errors: 0,
            deletedCompanies: [],
            keptCompanies: []
        };

        // Import scraper and research service
        const { scrapeWebsiteSmart, scrapeSpecificPages } = await import('./src/backend/services/apify.js');
        const { ResearchService } = await import('./src/backend/services/research-service.js');
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

        // Process each company
        for (const company of companies) {
            try {
                let profile = company.company_profile || '';
                const website = company.website || '';
                const companyName = company.company_name;

                send({ type: 'processing', company: companyName, step: 'Evaluating profile quality...' });

                // ALWAYS try to get more info - check if profile needs enhancement
                const needsMoreInfo = !profile ||
                    profile.length < 500 ||
                    profile.toLowerCase().includes('more information needed') ||
                    profile.toLowerCase().includes('unclear') ||
                    !profile.toLowerCase().includes('invest');

                // ALWAYS scrape website if we need more info or if profile is weak
                if (needsMoreInfo && website) {
                    send({ type: 'scraping', company: companyName, message: 'Scraping website for detailed info...' });
                    try {
                        // First try smart scrape of homepage
                        let scraped = await scrapeWebsiteSmart(website);

                        // If we got content, try to find and scrape about/investment pages
                        if (scraped && scraped.length > 200) {
                            profile = scraped.substring(0, 4000);
                            results.scraped++;

                            // Look for key pages to scrape for more detail
                            const keyPagePatterns = ['/about', '/investment', '/portfolio', '/strategy', '/team', '/deals'];
                            const pagesToScrape = [];
                            for (const pattern of keyPagePatterns) {
                                if (scraped.toLowerCase().includes(pattern)) {
                                    const fullUrl = website.replace(/\/$/, '') + pattern;
                                    pagesToScrape.push(fullUrl);
                                }
                            }

                            // Scrape additional pages if found
                            if (pagesToScrape.length > 0) {
                                send({ type: 'deep-scraping', company: companyName, pages: pagesToScrape.length });
                                try {
                                    const additionalContent = await scrapeSpecificPages(pagesToScrape.slice(0, 3));
                                    if (additionalContent && additionalContent.length > 0) {
                                        const extraText = additionalContent.map(p => p.text || '').join('\n\n');
                                        profile = (profile + '\n\n' + extraText).substring(0, 6000);
                                    }
                                } catch (e) {
                                    console.log('Additional pages scrape failed:', e.message);
                                }
                            }
                        }
                    } catch (e) {
                        send({ type: 'scrape-failed', company: companyName, error: e.message });
                    }
                }

                // COMPREHENSIVE SCORING AND PROFILE GENERATION
                send({ type: 'scoring', company: companyName, message: 'AI analyzing and scoring...' });

                const comprehensivePrompt = `You are an expert Canadian real estate investment analyst. Thoroughly analyze this company:

COMPANY: ${companyName}
WEBSITE: ${website}
RAW DATA: ${profile.substring(0, 5000)}

## TASK 1: DEEP ANALYSIS
Analyze and extract:
- What type of entity is this? (SFO, MFO, PE Fund, REIT, Holdings, Wealth Manager, Broker, Service Provider, etc.)
- Do they make DIRECT investments in real estate or private equity?
- What is their investment focus? (residential, commercial, industrial, multi-family, etc.)
- What specific deals/projects have they done? (names, locations, values if mentioned)
- What is their scale? (AUM, portfolio size, deal sizes)
- Are they Canadian or have Canadian operations?
- Any red flags? (just advisory, brokerage only, non-investor)

## TASK 2: STRICT CATEGORIZATION
Assign the precise 'icp_type' Enum:

FAMILY OFFICES:
- "FAMILY_OFFICE_SINGLE": Investing for one family
- "FAMILY_OFFICE_MULTI": Investing for multiple families

FUNDS / INSTITUTIONS:
- "REAL_ESTATE_PRIVATE_EQUITY": Dedicated PE Fund
- "ASSET_MANAGER_MULTI_STRATEGY": Large manager (e.g. Blackstone, Brookfield)
- "REIT_PUBLIC": Publicly traded REIT
- "PENSION": Pension fund
- "SOVEREIGN_WEALTH_FUND": SWF
- "INSURANCE_INVESTOR": Insurance company
- "RE_DEVELOPER_OPERATOR": Develops/Operates assets directly
- "REAL_ESTATE_DEBT_FUND": Debt fund
- "BANK_LENDER": Bank

OTHERS (DISQUALIFY):
- "NEITHER": Broker, Advisor, Service Provider, Unclear

## TASK 3: STRICT SCORING (1-10)
For FAMILY OFFICES (must score 8+ to keep):
- 9-10: Explicit SFO/MFO + names deals + Canadian + direct
- 8: Clear SFO/MFO + direct + Canadian
- 1-7: Not clearly SFO/MFO OR no direct investing

For FUNDS (must score 6+ to keep):
- 8-10: Dedicated REPE, REIT, institutional with deals
- 6-7: PE firm or holdings with RE assets
- 1-5: Pure service providers, brokers, lenders-only, unclear

For NEITHER: Score 1-3

BE STRICT. When in doubt, score LOW.

## TASK 4: GENERATE COMPREHENSIVE PROFILE
If keeping, write structured profile (Summary, Strategy, Scale/Geography, Highlights, Fit Analysis).
If NOT keeping, write "DISQUALIFIED: [reason]"

## OUTPUT JSON:
{
    "icp_type": "string (Enum Value from above)",
    "score": number (1-10),
    "reason": "string (1 sentence)",
    "needs_more_research": boolean,
    "company_profile": "string"
}`;

                let scoreData = null;
                try {
                    const result = await model.generateContent(comprehensivePrompt);
                    const text = result.response.text();
                    const jsonMatch = text.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        scoreData = JSON.parse(jsonMatch[0]);
                    }
                } catch (e) {
                    console.error('AI scoring failed:', e.message);
                    results.errors++;
                }

                if (!scoreData) {
                    send({ type: 'error', company: companyName, message: 'AI scoring failed' });
                    results.processed++;
                    continue;
                }

                // If AI says needs more research and score is borderline, try deep research
                if (scoreData.needs_more_research && scoreData.score >= 5 && scoreData.score < 8 && website) {
                    send({ type: 'deep-research', company: companyName, message: 'Uncertain - doing deep research...' });
                    try {
                        const deepProfile = await ResearchService.generateProfileFromUrl(website, 'Investment focus, portfolio, deals, AUM, strategy');
                        if (deepProfile && deepProfile.length > 200) {
                            // Re-score with better data
                            const reScoreResult = await model.generateContent(comprehensivePrompt.replace(profile.substring(0, 5000), deepProfile.substring(0, 5000)));
                            const reScoreText = reScoreResult.response.text();
                            const reScoreMatch = reScoreText.match(/\{[\s\S]*\}/);
                            if (reScoreMatch) {
                                scoreData = JSON.parse(reScoreMatch[0]);
                                results.scraped++;
                            }
                        }
                    } catch (e) {
                        console.log('Deep research failed:', e.message);
                    }
                }

                // Determine threshold based on category
                const icpType = scoreData.icp_type || 'NEITHER';
                const isFamilyOffice = icpType.includes('FAMILY_OFFICE');
                const threshold = isFamilyOffice ? 8 : 6;
                const shouldDelete = icpType === 'NEITHER' || scoreData.score < threshold;

                send({
                    type: 'scored',
                    company: companyName,
                    category: icpType,
                    score: scoreData.score,
                    threshold,
                    action: shouldDelete ? 'DELETE' : 'KEEP',
                    reason: scoreData.reason
                });

                if (shouldDelete) {
                    // Delete company and all its leads
                    await query('DELETE FROM leads WHERE company_name = $1 AND user_id = $2', [companyName, userId]);
                    await query('DELETE FROM companies WHERE id = $1', [company.id]);
                    await query('DELETE FROM researched_companies WHERE company_name = $1 AND user_id = $2', [companyName, userId]);

                    results.deleted++;
                    results.deletedCompanies.push({ name: companyName, score: scoreData.score, reason: scoreData.reason });
                } else {
                    // Update company with new score and comprehensive profile AND ICP TYPE
                    await query(`
                        UPDATE companies 
                        SET fit_score = $1, company_profile = $2, icp_type = $3, last_updated = NOW()
                        WHERE id = $4
                    `, [scoreData.score, scoreData.company_profile || profile, icpType, company.id]);

                    // Also update leads with new score
                    await query(`
                        UPDATE leads 
                        SET custom_data = custom_data || $1::jsonb
                        WHERE company_name = $2 AND user_id = $3
                    `, [JSON.stringify({ fit_score: scoreData.score, cleanup_verified: true, cleanup_date: new Date().toISOString() }), companyName, userId]);

                    results.kept++;
                    results.rescored++;
                    results.keptCompanies.push({ name: companyName, score: scoreData.score, category: icpType });
                }

                results.processed++;

                // Progress update every 5 companies
                if (results.processed % 5 === 0) {
                    send({ type: 'progress', ...results });
                }

            } catch (e) {
                console.error(`Error processing ${company.company_name}:`, e);
                results.errors++;
                results.processed++;
            }
        }

        send({ type: 'complete', results });
        res.end();

    } catch (e) {
        console.error('Deep cleanup failed:', e);
        send({ type: 'error', message: e.message });
        res.end();
    }
});

// ============================================================================
// DEEP CLEANUP V2 - Comprehensive investor database cleanup with hardcoded actions
// ============================================================================
app.post('/api/admin/deep-cleanup-v2', requireAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        const userId = req.userId;

        // Import cleanup functions
        const {
            COMPANY_ACTIONS,
            cleanCompanyName,
            extractRootDomain,
            checkDomainMatch,
            calculateFitScore,
            shouldKeepLead,
            classifyLeadSeniority,
            classifyLeadRoleGroup
        } = await import('./src/backend/services/deep-cleanup-v2.js');

        send({ type: 'status', message: '🚀 Deep Cleanup V2 Starting...' });
        send({ type: 'status', message: `Loaded ${Object.keys(COMPANY_ACTIONS).length} predefined company actions` });

        // Step 1: Run schema migration
        send({ type: 'phase', phase: 1, message: 'Running schema migration...' });
        try {
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_name_clean TEXT`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS website_root_domain TEXT`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS icp_type TEXT`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS capital_role TEXT`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS canada_relevance TEXT`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS data_quality_flags JSONB DEFAULT '[]'`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 50`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS fit_score_breakdown JSONB`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS cleanup_status TEXT DEFAULT 'PENDING'`);
            await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id UUID`);
            await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_role_group TEXT`);
            await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_seniority TEXT`);
            send({ type: 'status', message: '✅ Schema migration complete' });
        } catch (e) {
            send({ type: 'warning', message: 'Schema migration partial: ' + e.message });
        }

        // Step 2: Get all companies
        send({ type: 'phase', phase: 2, message: 'Fetching all companies...' });
        const { rows: companies } = await query(`
            SELECT id, company_name, website, company_profile, fit_score, user_id
            FROM companies WHERE user_id = $1
            ORDER BY company_name
        `, [userId]);

        send({ type: 'status', message: `Found ${companies.length} companies to process` });

        const results = {
            total: companies.length,
            processed: 0,
            kept: 0,
            deleted: 0,
            merged: 0,
            review_required: 0,
            errors: 0,
            leads_deleted: 0,
            leads_updated: 0,
            actions: [],
            duplicates_found: []
        };

        // Step 3: Normalize and apply actions
        send({ type: 'phase', phase: 3, message: 'Processing companies...' });

        const domainMap = new Map(); // Track domains for duplicate detection

        for (const company of companies) {
            try {
                const nameClean = cleanCompanyName(company.company_name);
                const rootDomain = extractRootDomain(company.website || '');

                // Check for duplicate by domain
                if (rootDomain && domainMap.has(rootDomain)) {
                    const existingCompany = domainMap.get(rootDomain);
                    results.duplicates_found.push({
                        duplicate: company.company_name,
                        canonical: existingCompany,
                        domain: rootDomain
                    });
                } else if (rootDomain) {
                    domainMap.set(rootDomain, company.company_name);
                }

                // Look up in hardcoded actions
                let action = COMPANY_ACTIONS[company.company_name] ||
                    COMPANY_ACTIONS[nameClean] ||
                    null;

                // Try partial match for company names
                if (!action) {
                    for (const [key, value] of Object.entries(COMPANY_ACTIONS)) {
                        if (company.company_name.toLowerCase().includes(key.toLowerCase()) ||
                            key.toLowerCase().includes(company.company_name.toLowerCase())) {
                            action = value;
                            break;
                        }
                    }
                }

                let status = 'PENDING';
                let icp_type = null;
                let capital_role = null;
                let flags = [];
                let confidence = 50;

                if (action) {
                    status = action.status;
                    icp_type = action.icp_type || null;
                    capital_role = action.capital_role || null;
                    flags = action.flags || [];
                    confidence = status === 'KEEP' ? 90 : (status === 'DELETE' ? 10 : 50);
                } else {
                    // No hardcoded action - check domain match
                    const domainCheck = checkDomainMatch(company.company_name, rootDomain);
                    if (!domainCheck.match && rootDomain) {
                        flags.push('DOMAIN_MISMATCH');
                        status = 'REVIEW_REQUIRED';
                        confidence = 30;
                    }
                }

                // Calculate fit score - let the function apply intelligent defaults for missing fields
                const canada_relevance = action?.canada_relevance || '';  // Let calculateFitScore apply default
                const fitResult = calculateFitScore({ icp_type, capital_role, canada_relevance });

                // Check for auto-duplicates if not already handled by hardcoded action
                if (!action && rootDomain && domainMap.has(rootDomain)) {
                    status = 'MERGE';
                    action = { merge_into: domainMap.get(rootDomain) };
                }

                // Apply action
                if (status === 'DELETE') {
                    // Delete company and leads
                    const leadsDeleted = await query('DELETE FROM leads WHERE company_name = $1 AND user_id = $2 RETURNING id', [company.company_name, userId]);
                    await query('DELETE FROM companies WHERE id = $1', [company.id]);
                    await query('DELETE FROM researched_companies WHERE company_name = $1 AND user_id = $2', [company.company_name, userId]);

                    results.deleted++;
                    results.leads_deleted += leadsDeleted.rowCount;

                    send({ type: 'action', company: company.company_name, status: 'DELETED', reason: flags.join(', ') || icp_type });
                } else if (status === 'MERGE') {
                    // Truly MERGE: Reassign leads and delete
                    const target = action?.merge_into;
                    if (target) {
                        const leadRes = await query(
                            'UPDATE leads SET company_name = $1 WHERE company_name = $2 AND user_id = $3',
                            [target, company.company_name, userId]
                        );
                        results.leads_updated += leadRes.rowCount;
                    }

                    await query('DELETE FROM companies WHERE id = $1', [company.id]);
                    await query('DELETE FROM researched_companies WHERE company_name = $1 AND user_id = $2', [company.company_name, userId]);

                    results.deleted++;
                    results.merged++;
                    send({ type: 'action', company: company.company_name, status: 'MERGED & DELETED', merge_into: target });
                } else if (fitResult.fit_score < 6 && status !== 'KEEP') {
                    // Low score + no whitelist = DELETE
                    const leadsDeleted = await query('DELETE FROM leads WHERE company_name = $1 AND user_id = $2 RETURNING id', [company.company_name, userId]);
                    await query('DELETE FROM companies WHERE id = $1', [company.id]);
                    await query('DELETE FROM researched_companies WHERE company_name = $1 AND user_id = $2', [company.company_name, userId]);

                    results.deleted++;
                    results.leads_deleted += leadsDeleted.rowCount;
                    send({ type: 'action', company: company.company_name, status: 'DELETED (AUTO)', reason: 'Score < 6' });
                } else {
                    // KEEP or REVIEW_REQUIRED - update the record
                    await query(`
                        UPDATE companies SET 
                            cleanup_status = $1,
                            icp_type = $2,
                            capital_role = $3,
                            canada_relevance = $4,
                            data_quality_flags = $5,
                            confidence_score = $6,
                            fit_score = $7,
                            fit_score_breakdown = $8,
                            company_name_clean = $9,
                            website_root_domain = $10,
                            last_updated = NOW()
                        WHERE id = $11
                    `, [
                        status,
                        icp_type,
                        capital_role,
                        canada_relevance || 'CANADA_ACTIVE',
                        JSON.stringify(flags),
                        confidence,
                        fitResult.fit_score,
                        JSON.stringify(fitResult.fit_score_breakdown),
                        nameClean,
                        rootDomain,
                        company.id
                    ]);

                    if (status === 'KEEP') {
                        results.kept++;
                        send({ type: 'action', company: company.company_name, status: 'KEPT', icp_type, fit_score: fitResult.fit_score });
                    } else {
                        results.review_required++;
                        send({ type: 'action', company: company.company_name, status: 'REVIEW_REQUIRED', flags });
                    }
                }

                results.processed++;
                results.actions.push({
                    company: company.company_name,
                    status,
                    icp_type,
                    fit_score: fitResult.fit_score,
                    flags
                });

                // Progress update
                if (results.processed % 10 === 0) {
                    send({ type: 'progress', ...results });
                }

            } catch (e) {
                console.error(`Error processing ${company.company_name}:`, e);
                results.errors++;
                results.processed++;
            }
        }

        // Step 4: Clean up leads
        send({ type: 'phase', phase: 4, message: 'Cleaning up leads...' });

        const { rows: allLeads } = await query(`
            SELECT id, job_title, company_name FROM leads WHERE user_id = $1
        `, [userId]);

        for (const lead of allLeads) {
            const keep = shouldKeepLead(lead.job_title);
            const seniority = classifyLeadSeniority(lead.job_title);
            const roleGroup = classifyLeadRoleGroup(lead.job_title);

            if (!keep) {
                await query('DELETE FROM leads WHERE id = $1', [lead.id]);
                results.leads_deleted++;
            } else {
                await query(`
                    UPDATE leads SET lead_seniority = $1, lead_role_group = $2 WHERE id = $3
                `, [seniority, roleGroup, lead.id]);
                results.leads_updated++;
            }
        }

        // Step 5: Generate QA Report
        send({ type: 'phase', phase: 5, message: 'Generating QA report...' });

        const qaReport = {
            summary: {
                total_processed: results.processed,
                kept: results.kept,
                deleted: results.deleted,
                merged: results.merged,
                review_required: results.review_required,
                errors: results.errors
            },
            leads: {
                deleted: results.leads_deleted,
                updated: results.leads_updated
            },
            duplicates: results.duplicates_found.slice(0, 20),
            domain_mismatches: results.actions
                .filter(a => a.flags?.includes('DOMAIN_MISMATCH'))
                .slice(0, 20)
                .map(a => a.company)
        };

        send({ type: 'complete', results, qaReport });
        res.end();

    } catch (e) {
        console.error('Deep cleanup v2 failed:', e);
        send({ type: 'error', message: e.message });
        res.end();
    }
});

// Quick ICP Type Fix - Apply hardcoded company classifications
app.post('/api/admin/fix-icp-types', requireAuth, async (req, res) => {
    try {
        const { COMPANY_ACTIONS, cleanCompanyName } = await import('./src/backend/services/deep-cleanup-v2.js');

        const { rows: companies } = await query(`
            SELECT id, company_name FROM companies WHERE user_id = $1
        `, [req.userId]);

        let updated = 0;
        let errors = 0;
        const log = [];

        for (const company of companies) {
            try {
                const nameClean = cleanCompanyName(company.company_name);

                // Look up in hardcoded actions
                let action = COMPANY_ACTIONS[company.company_name] ||
                    COMPANY_ACTIONS[nameClean] ||
                    null;

                // Try partial match
                if (!action) {
                    for (const [key, value] of Object.entries(COMPANY_ACTIONS)) {
                        if (company.company_name.toLowerCase().includes(key.toLowerCase()) ||
                            key.toLowerCase().includes(company.company_name.toLowerCase())) {
                            action = value;
                            break;
                        }
                    }
                }

                if (action && action.icp_type) {
                    await query(`
                        UPDATE companies SET icp_type = $1 WHERE id = $2
                    `, [action.icp_type, company.id]);
                    updated++;
                    log.push({ company: company.company_name, icp_type: action.icp_type });
                }
            } catch (e) {
                errors++;
            }
        }

        res.json({ success: true, updated, errors, total: companies.length, log });
    } catch (e) {
        console.error('Fix ICP types failed:', e);
        res.status(500).json({ error: e.message });
    }
});

// TEMP: Backfill Companies from Leads
app.post('/api/admin/backfill-companies', async (req, res) => {
    try {
        console.log('Starting companies backfill...');

        // 1. Get unique companies from leads
        const { rows: leads } = await query(`
            SELECT DISTINCT ON (user_id, company_name)
                user_id,
                company_name,
                custom_data->>'company_website' as website,
                custom_data->>'company_domain' as domain,
                custom_data->>'company_profile' as company_profile,
                custom_data->>'score' as fit_score
            FROM leads
            WHERE company_name IS NOT NULL
        `);

        console.log(`Found ${leads.length} unique companies in leads table.`);

        let inserted = 0;
        let updated = 0;

        for (const lead of leads) {
            try {
                // Determine valid score
                let score = parseInt(lead.fit_score);
                if (isNaN(score)) score = null;

                const finalWebsite = lead.website || lead.domain;

                const result = await query(`
                    INSERT INTO companies (user_id, company_name, website, company_profile, fit_score, created_at, last_updated)
                    VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                    ON CONFLICT (user_id, company_name) 
                    DO UPDATE SET
                        website = COALESCE(companies.website, EXCLUDED.website),
                        company_profile = COALESCE(companies.company_profile, EXCLUDED.company_profile),
                        fit_score = COALESCE(companies.fit_score, EXCLUDED.fit_score),
                        last_updated = NOW()
                    RETURNING (xmax = 0) as inserted
                `, [lead.user_id, lead.company_name, finalWebsite, lead.company_profile, score]);

                if (result.rows[0].inserted) inserted++;
                else updated++;
            } catch (err) {
                console.error(`Failed to upsert ${lead.company_name}:`, err.message);
            }
        }

        res.json({
            success: true,
            totalFound: leads.length,
            inserted,
            updated,
            message: `Processed ${leads.length} companies. Inserted: ${inserted}, Updated: ${updated}`
        });
    } catch (e) {
        console.error('Backfill error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- AUTHENTICATION ENDPOINTS ---

// Sign Up
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, name } = req.body

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
    }

    try {
        // Check if user already exists
        const existingUser = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email])
        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' })
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10)

        // Create user
        const { rows } = await query(
            `INSERT INTO users (email, name, password_hash, role, onboarding_completed, credits)
             VALUES ($1, $2, $3, 'user', FALSE, 500000)
             RETURNING id, email, name, role, onboarding_completed`,
            [email.toLowerCase(), name || email.split('@')[0], passwordHash]
        )

        const user = rows[0]

        // Generate JWT token
        const token = generateToken(user)

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        })

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed
            }
        })
    } catch (err) {
        console.error('Signup error:', err)
        res.status(500).json({ error: 'Failed to create account' })
    }
})

// Log In
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' })
    }

    try {
        // Find user
        const { rows } = await query(
            'SELECT id, email, name, role, password_hash, onboarding_completed FROM users WHERE LOWER(email) = LOWER($1)',
            [email]
        )

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        const user = rows[0]

        // Check if password_hash is null (owner account before password set)
        if (!user.password_hash) {
            return res.status(403).json({
                error: 'Account requires password setup',
                code: 'PASSWORD_SETUP_REQUIRED',
                message: 'Please contact administrator to set up your password'
            })
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash)
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        // Generate JWT token
        const token = generateToken(user)

        // Set httpOnly cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        })

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed
            }
        })
    } catch (err) {
        console.error('Login error:', err)
        res.status(500).json({ error: 'Failed to log in' })
    }
})

// Log Out
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('token')
    res.json({ success: true })
})

// Get Current User
app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT id, email, name, role, onboarding_completed, onboarding_state, credits FROM users WHERE id = $1',
            [req.userId]
        )

        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' })
        }

        const user = rows[0]
        res.json({
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            onboardingCompleted: user.onboarding_completed,
            onboardingState: user.onboarding_state || {},
            credits: user.credits
        })
    } catch (err) {
        console.error('Get user error:', err)
        res.status(500).json({ error: 'Failed to fetch user data' })
    }
})

// Complete Onboarding
app.post('/api/auth/complete-onboarding', requireAuth, async (req, res) => {
    try {
        await query(
            'UPDATE users SET onboarding_completed = TRUE, updated_at = NOW() WHERE id = $1',
            [req.userId]
        )

        // Return updated user
        const { rows } = await query(
            'SELECT id, email, name, role, onboarding_completed, onboarding_state, credits FROM users WHERE id = $1',
            [req.userId]
        )

        const user = rows[0]
        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                onboardingCompleted: user.onboarding_completed,
                onboardingState: user.onboarding_state || {},
                credits: user.credits
            }
        })
    } catch (err) {
        console.error('Complete onboarding error:', err)
        res.status(500).json({ error: 'Failed to complete onboarding' })
    }
})


// Get Agent Prompts
app.get('/api/agent-prompts', requireAuth, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM agent_prompts WHERE user_id = $1', [req.userId])
        const prompts = rows.reduce((acc, row) => {
            acc[row.agent_id] = row.system_prompt
            return acc
        }, {})
        res.json(prompts)
    } catch (err) {
        console.error('Failed to fetch prompts:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Save Agent Prompts
app.post('/api/agent-prompts', requireAuth, async (req, res) => {
    const { prompts } = req.body // Expects array of { id, name, prompt }
    if (!Array.isArray(prompts)) return res.status(400).json({ error: 'Invalid data format' })

    try {
        await query('BEGIN')
        for (const p of prompts) {
            // Upsert with user_id
            await query(
                `INSERT INTO agent_prompts (agent_id, name, system_prompt, config, user_id) 
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (agent_id, user_id) 
                 DO UPDATE SET system_prompt = $3, name = $2, config = CASE WHEN $4::jsonb IS NOT NULL THEN $4 ELSE agent_prompts.config END, updated_at = NOW()`,
                [p.id, p.name, p.prompt, p.config || {}, req.userId]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save prompts:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

import OpenAI from 'openai'
import { Runner } from "@openai/agents";
import { OutreachService } from "./src/backend/services/outreach-service.js";
import { createOutreachAgent } from "./src/backend/agent-setup.js";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
})

// --- API Endpoints ---

// Prompt Optimization (LLM)
app.post('/api/optimize-prompt', async (req, res) => {
    const { agentName, inputs, baseTemplate } = req.body
    if (!agentName || !inputs) return res.status(400).json({ error: 'Missing data' })

    try {
        const systemPrompt = `You are an expert AI Engineer.
Your goal is to write a highly effective System Instruction for an AI Agent named "${agentName}".

The user has provided the following configuration inputs:
${JSON.stringify(inputs, null, 2)}

And here is a basic template/intent for the agent:
"${baseTemplate}"

**TASK:**
Rewrite the system instruction to be professional, robust, and optimized for an LLM.
- Use clear sections (GOAL, BEHAVIOR, CONSTRAINTS).
- Ensure specific user inputs are integrated naturally.
- Do NOT include any placeholder brackets like {{value}}. Fill them in.
- Return ONLY the prompt text. No markdown fences.`

        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: systemPrompt }],
        })

        const optimizedPrompt = completion.choices[0].message.content.trim()
        res.json({ prompt: optimizedPrompt })
    } catch (err) {
        console.error('Prompt Optimization Failed:', err)
        res.status(500).json({ error: 'Optimization failed' })
    }
})

// 2. Get Agent Configs (For UI)
app.get('/api/agents/config', requireAuth, async (req, res) => {
    try {
        const { rows } = await query("SELECT * FROM agent_prompts WHERE user_id = $1", [req.userId])
        const configs = {}

        rows.forEach(row => {
            configs[row.agent_id] = {
                instructions: row.system_prompt,
                enabledToolIds: row.config?.enabledToolIds || [],
                linkedFileIds: row.config?.linkedFileIds || []
            }
        })

        res.json({ configs })
    } catch (err) {
        console.error('Failed to fetching agent configs:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// 3. Save Agent Config (From UI)
app.post('/api/agents/config', requireAuth, async (req, res) => {
    const { agentKey, instructions, enabledToolIds, linkedFileIds } = req.body

    try {
        const name = agentKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

        const configObj = {
            enabledToolIds: enabledToolIds || [],
            linkedFileIds: linkedFileIds || []
        }

        await query(
            `INSERT INTO agent_prompts (agent_id, name, system_prompt, config, user_id) 
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (agent_id, user_id) DO UPDATE SET 
                system_prompt = EXCLUDED.system_prompt,
                config = agent_prompts.config || EXCLUDED.config,
                updated_at = NOW()`,
            [agentKey, name, instructions, configObj, req.userId]
        )

        res.json({ success: true })
    } catch (err) {
        console.error('Failed to save agent config:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// 4. Create New ICP Strategy
app.post('/api/icps', requireAuth, async (req, res) => {
    const { name, config, agent_config } = req.body

    if (!name) return res.status(400).json({ error: 'ICP Name is required' })

    try {
        const { rows } = await query(
            `INSERT INTO icps (user_id, name, config, agent_config) 
             VALUES ($1, $2, $3, $4)
             RETURNING id, name, created_at`,
            [req.userId, name, config || {}, agent_config || {}]
        )
        res.json({ success: true, icp: rows[0] })
    } catch (err) {
        console.error('Failed to create ICP:', err)
        res.status(500).json({ error: 'Database error' })
    }
})


// 5. Enrich Lead (LeadMagic)
app.post('/api/leads/:id/enrich', requireAuth, async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Get Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

        const lead = rows[0];

        // 2. Validate
        if (!lead.linkedin_url) {
            return res.status(400).json({ error: 'Lead is missing LinkedIn URL' });
        }

        // 3. Call LeadMagic
        const enrichedData = await leadMagic.enrichByLinkedin(lead.linkedin_url);

        if (!enrichedData) {
            return res.json({ success: false, message: 'No mobile number found' });
        }

        // 4. Update Database
        // Append new numbers to existing phone_numbers JSONB array
        let existingPhones = lead.phone_numbers || [];
        if (!Array.isArray(existingPhones)) existingPhones = [];

        // Check if we already have this number to avoid dupes
        const newNumber = enrichedData.mobile_phone;
        const exists = existingPhones.some(p => p.number === newNumber);

        if (!exists && newNumber) {
            existingPhones.push({
                type: 'mobile',
                number: newNumber,
                source: 'LeadMagic',
                added_at: new Date().toISOString()
            });

            // Also add work phone if present
            if (enrichedData.work_phone) {
                existingPhones.push({ type: 'work', number: enrichedData.work_phone, source: 'LeadMagic' });
            }

            await query(
                `UPDATE leads SET phone_numbers = $1, status = 'ENRICHED', updated_at = NOW() WHERE id = $2`,
                [JSON.stringify(existingPhones), id]
            );

            return res.json({ success: true, phones: existingPhones });
        } else {
            return res.json({ success: true, message: 'Number already exists or invalid', phones: existingPhones });
        }

    } catch (err) {
        console.error('Enrichment failed:', err);
        res.status(500).json({ error: err.message || 'Enrichment failed' });
    }
});
// --- Knowledge Base & Files ---

// 1. Create Internal Strategy Guide & Vector Store
app.post('/api/knowledge/create-internal', requireAuth, async (req, res) => {
    const { answers, agentConfigs } = req.body

    try {
        // 1. Compile Strategy Guide Content
        let content = `# Internal Strategy Guide & Agent Protocols\nGenerated: ${new Date().toISOString()}\n\n`

        // Add Research Framework
        if (answers.research_framework) {
            content += `## Research Framework\n${JSON.stringify(answers.research_framework, null, 2)}\n\n`
        }

        // Add Outreach Strategy
        if (answers.outreach_creator) {
            content += `## Outreach Strategy\n${JSON.stringify(answers.outreach_creator, null, 2)}\n\n`
        }

        // 2. Get or Create Vector Store 
        let vectorStoreId = null
        const { rows } = await query("SELECT value FROM system_config WHERE user_id = $1 AND key = 'default_vector_store'", [req.userId])

        if (rows.length > 0 && rows[0].value?.id) {
            vectorStoreId = rows[0].value.id
        } else {
            // Create new
            const vsResponse = await fetch('https://api.openai.com/v1/vector_stores', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                    'OpenAI-Beta': 'assistants=v2'
                },
                body: JSON.stringify({
                    name: "Elvison OS - Knowledge Base"
                })
            })

            if (!vsResponse.ok) {
                const errText = await vsResponse.text()
                throw new Error(`OpenAI VS Creation Failed: ${vsResponse.status} - ${errText}`)
            }
            const vsData = await vsResponse.json()
            vectorStoreId = vsData.id

            // Save to DB
            await query(
                `INSERT INTO system_config (key, value, user_id) VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
                ['default_vector_store', { id: vectorStoreId }, req.userId]
            )
        }

        // 3. CLEANUP: Delete old versions of the guide from VS
        try {
            // List files in VS
            const vsFilesRes = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'OpenAI-Beta': 'assistants=v2'
                }
            })

            if (vsFilesRes.ok) {
                const vsFilesData = await vsFilesRes.json()
                const fileIds = vsFilesData.data.map(f => f.id)

                // We need file details (names) to identifying duplicates.
                // Since we can't get name from VS-File object directly efficiently without listing all files or storing map,
                // And listing ALL files is heavy...
                // Strategy: We only want to delete files named "INTERNAL_STRATEGY_GUIDE.md".
                // We can't query by name easily.
                // Alternative: Save the current 'internal_guide_file_id' in system_config.

                // Let's try fetching the file object for each VS file to check name.
                // Proceed with system_config approach for future, but to fix current mess, iteration is needed.
                // Given the user likely only has a few files, listing ALL files is acceptable for now.

                const allFilesRes = await fetch('https://api.openai.com/v1/files', {
                    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                })

                if (allFilesRes.ok) {
                    const allFilesData = await allFilesRes.json()
                    const filesToDelete = allFilesData.data.filter(f =>
                        fileIds.includes(f.id) && f.filename === 'INTERNAL_STRATEGY_GUIDE.md'
                    )

                    for (const f of filesToDelete) {
                        // Remove from VS
                        await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${f.id}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                                'OpenAI-Beta': 'assistants=v2'
                            }
                        })
                        // Delete File Object
                        await fetch(`https://api.openai.com/v1/files/${f.id}`, {
                            method: 'DELETE',
                            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
                        })
                    }
                }
            }
        } catch (cleanupErr) {
            console.warn("Cleanup of old guides failed, continuing:", cleanupErr)
        }


        // 4. Upload NEW File to OpenAI (Direct Fetch)
        const tempFilePath = path.join(__dirname, 'INTERNAL_STRATEGY_GUIDE.md')
        const fs = await import('fs/promises')
        await fs.writeFile(tempFilePath, content)

        const fileFormData = new FormData()
        fileFormData.append('purpose', 'assistants')
        const fileBlob = new Blob([await fs.readFile(tempFilePath)])
        fileFormData.append('file', fileBlob, 'INTERNAL_STRATEGY_GUIDE.md')

        const fileResponse = await fetch('https://api.openai.com/v1/files', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: fileFormData
        })

        if (!fileResponse.ok) {
            const errText = await fileResponse.text()
            throw new Error(`OpenAI File Upload Failed: ${fileResponse.status} - ${errText}`)
        }
        const fileData = await fileResponse.json()
        const fileId = fileData.id

        // Cleanup temp file
        await fs.unlink(tempFilePath)

        // 4. Add File to Vector Store (Direct Fetch)
        const vsFileResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                file_id: fileId
            })
        })

        if (!vsFileResponse.ok) {
            const errText = await vsFileResponse.text()
            throw new Error(`OpenAI VS File Attach Failed: ${vsFileResponse.status} - ${errText}`)
        }

        res.json({ success: true, vectorStoreId, fileId: fileId })

    } catch (err) {
        console.error('KB Creation Failed:', err)
        res.status(500).json({ error: err.message })
    }
})

// --- ICP & CLEANUP ---

// --- RESEARCH ---
import { ResearchService } from './src/backend/services/research-service.js';

app.post('/api/companies/research/scan', async (req, res) => {
    try {
        const { url, topic } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        const { recommended, all } = await ResearchService.scanCompany(url, topic);
        res.json({ recommended, all });
    } catch (e) {
        console.error('Research Scan Error:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/companies/research', async (req, res) => {
    try {
        const { urls, topic, companyName } = req.body;
        if (!urls || !Array.isArray(urls)) return res.status(400).json({ error: 'List of URLs is required' });

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const result = await ResearchService.researchCompany(urls, topic, (msg) => sendProgress(res, msg));

        // Merge with existing profile if companyName provided
        let finalResult = result;

        if (companyName) {
            try {
                sendProgress(res, 'Merging with existing profile...');
                // Get existing profile
                const { rows } = await query(
                    'SELECT company_profile FROM companies WHERE company_name = $1',
                    [companyName]
                );

                const existingProfile = rows[0]?.company_profile || '';

                // Use AI to merge old + new research
                const mergedProfile = await ResearchService.mergeProfiles(existingProfile, result);
                finalResult = mergedProfile;

                await query(
                    `UPDATE companies 
                     SET company_profile = $1, last_updated = NOW() 
                     WHERE company_name = $2`,
                    [mergedProfile, companyName]
                );
                console.log(`✅ Merged and saved deep research for ${companyName}`);

            } catch (dbError) {
                console.error('Failed to merge/save research:', dbError);
                // Fallback: return the new research even if merge fails
            }
        }

        // Send final result
        res.write(`data: ${JSON.stringify({ type: 'complete', result: finalResult })}\n\n`);
        res.end();

    } catch (e) {
        console.error('Deep research failed:', e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        }
    }
});

// Full Site Scan Endpoint (Streaming)
app.post('/api/companies/research/full-scan', requireAuth, async (req, res) => {
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const { url, maxCost } = req.body;

    if (!url) {
        send({ type: 'error', error: 'No URL provided' });
        res.end();
        return;
    }

    try {
        const { ResearchService } = await import('./src/backend/services/research-service.js');
        const token = process.env.APIFY_API_TOKEN;
        const limit = maxCost ? parseFloat(maxCost) : 5.00;

        // Keep SSE connection alive with heartbeats every 5s (Railway timeout protection)
        const heartbeat = setInterval(() => {
            try {
                res.write(': heartbeat\n\n');
            } catch (e) {
                console.error('[SSE] Heartbeat write failed:', e.message);
                clearInterval(heartbeat);
            }
        }, 5000);

        await ResearchService.runFullSiteScan(url, token, limit, (stats) => {
            // Map Apify stats to our frontend event format
            console.log('[Full Scan] Progress callback:', stats);
            if (stats.status === 'PARTIAL_LIMIT_REACHED') {
                send({ type: 'progress', stats: { ...stats, status: 'LIMIT REACHED - SAVING DATA...' } });
            } else if (stats.status === 'ABORTED_COST_LIMIT') {
                send({ type: 'error', error: `Cost limit exceeded ($${stats.cost.toFixed(2)})` });
            } else if (stats.status === 'FAILED') {
                send({ type: 'error', error: 'Scrape failed internally.' });
            } else {
                send({ type: 'progress', stats });
            }
        }).then(async (result) => {
            clearInterval(heartbeat);

            // Handle normal completion OR partial completion
            if (result.aborted && !result.items) {
                res.end();
                return;
            }

            console.log(`[Full Scan] Scrape done (${result.items?.length || 0} pages). Starting batched synthesis for ${url}...`);
            send({ type: 'progress', stats: { ...result, status: `Scrape Finished: ${result.items?.length || 0} pages collected.` } });

            let finalReport = '';
            try {
                // If we have items (even partial), synthesize it using batched logic
                if (result.items && result.items.length > 0) {
                    finalReport = await ResearchService.synthesizeFullScanReport(
                        result.items,
                        url,
                        (msg) => {
                            console.log(`[Full Scan] Analysis Progress: ${msg}`);
                            send({ type: 'progress', stats: { ...result, status: msg } });
                        }
                    );
                } else {
                    finalReport = "No content scraped to analyze.";
                }

                // Append the "Budget Reached" warning to the report if needed
                const limitStr = maxCost ? parseFloat(maxCost) : 5.00;
                if (result.status === 'PARTIAL_LIMIT_REACHED') {
                    finalReport = `> [!WARNING]\n> **Scan Incomplete**: Budget limit ($${limitStr}) reached. Analysis is based on ${result.pages} scraped pages.\n\n` + finalReport;
                }

                // 3. SAVE TO DATABASE
                send({ type: 'progress', stats: { ...result, status: 'SAVING_TO_DB' } });

                // Update company profile
                const { rows } = await pool.query(
                    `UPDATE companies 
                     SET market_intelligence = $1, 
                         last_researched_at = NOW(),
                         fit_score = CASE WHEN $1 ILIKE '%High fit%' THEN 85 WHEN $1 ILIKE '%Medium fit%' THEN 60 ELSE fit_score END
                     WHERE website ILIKE $2 OR website ILIKE $3
                     RETURNING *`,
                    [finalReport, `%${url}%`, `%${new URL(url.startsWith('http') ? url : 'https://' + url).hostname}%`]
                );

                if (rows.length === 0) {
                    console.warn(`[Deep Research] Could not find company to update for URL: ${url}`);
                } else {
                    console.log(`[Deep Research] Updated profile for ${rows[0].company_name}`);
                }

                send({ type: 'complete', result: finalReport, stats: result });
                res.end();

            } catch (err) {
                console.error("Synthesis failed:", err);
                send({ type: 'error', error: "Scrape successful, but analysis failed: " + err.message });
                res.end();
            }
        });

    } catch (e) {
        console.error("Full scan failed:", e);
        send({ type: 'error', error: e.message });
        res.end();
    }
});


// Manually update company profile (from Deep Research Result)
app.put('/api/companies/:companyName/profile', requireAuth, async (req, res) => {
    try {
        const { companyName } = req.params;
        const { profile } = req.body;

        if (!profile) return res.status(400).json({ error: 'Profile content is required' });

        await query(
            `INSERT INTO companies (user_id, company_name, company_profile, last_updated)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (user_id, company_name) 
             DO UPDATE SET company_profile = $3, last_updated = NOW()`,
            [req.userId, companyName, profile]
        );

        res.json({ success: true });
    } catch (e) {
        console.error('Update Profile Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Regenerate outreach messages for a company (used after Deep Research adds new info)
app.post('/api/companies/:companyName/regenerate-outreach', async (req, res) => {
    try {
        const { companyName } = req.params;

        // Get company details
        const { rows } = await query(
            'SELECT id, company_name, website, company_profile FROM companies WHERE company_name = $1',
            [companyName]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }

        const company = rows[0];

        // Import OutreachService dynamically
        const { OutreachService } = await import('./src/backend/services/outreach-service.js');

        // Generate new outreach messages
        const messages = await OutreachService.createLeadMessages({
            company_name: company.company_name,
            website: company.website,
            company_profile: company.company_profile
        });

        // Update in database
        await query(
            `UPDATE companies 
             SET linkedin_message = $1, email_subject = $2, email_body = $3 
             WHERE company_name = $4`,
            [messages.linkedin_message, messages.email_subject, messages.email_body, companyName]
        );

        console.log(`✅ Regenerated outreach for ${companyName}`);
        res.json({ success: true, messages });
    } catch (e) {
        console.error('Outreach Regeneration Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- MANUAL COMPANY RESEARCH ---
import { researchCompanyTeam, isDecisionMaker } from './src/backend/services/team-extractor-service.js';
import { enrichContact, enrichContactsBatch } from './src/backend/services/contact-enrichment-service.js';

// Add a company manually and extract team members
app.post('/api/companies/add-manual', requireAuth, async (req, res) => {
    try {
        const { url, researchTopic } = req.body;
        if (!url) return res.status(400).json({ error: 'Company URL is required' });

        // Set headers for streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Extract domain from URL
        const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();

        console.log(`[Manual Research] Starting research for ${domain}...`);

        // 1. Research the company and extract team
        const result = await researchCompanyTeam(url, (msg) => sendProgress(res, msg));

        if (result.error) {
            throw new Error(result.error);
        }

        // 2. Generate company profile using existing service
        sendProgress(res, 'Generating company profile...');
        let companyProfile = '';
        try {
            const { ResearchService } = await import('./src/backend/services/research-service.js');
            if (result.homepageText) {
                companyProfile = await ResearchService.generateProfileFromText(result.homepageText, researchTopic);
            }
        } catch (e) {
            console.warn('[Manual Research] Profile generation failed:', e.message);
            companyProfile = `Company: ${result.companyName}\nDomain: ${domain}`;
        }

        // 2b. UPSERT Company into Database (FIX: Ensure it exists in companies table)
        await query(
            `INSERT INTO companies (user_id, company_name, domain, website, company_profile, last_updated)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (user_id, company_name) 
             DO UPDATE SET company_profile = COALESCE(companies.company_profile, EXCLUDED.company_profile), last_updated = NOW()`,
            [req.userId, result.companyName, domain, url, companyProfile]
        );

        // 3. Save team members to database
        sendProgress(res, `Saving ${result.teamMembers.length} team members...`);
        const savedMembers = [];
        for (const member of result.teamMembers) {
            const insertResult = await query(
                `INSERT INTO company_team_members 
                 (user_id, company_name, company_domain, person_name, job_title, source_url, is_decision_maker, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'discovered')
                 ON CONFLICT DO NOTHING
                 RETURNING id, person_name, job_title, is_decision_maker, status`,
                [req.userId, result.companyName, domain, member.name, member.title, member.sourceUrl, member.isDecisionMaker]
            );

            if (insertResult.rows.length > 0) {
                savedMembers.push(insertResult.rows[0]);
            }
        }

        console.log(`[Manual Research] Saved ${savedMembers.length} team members for ${result.companyName}`);

        const responseData = {
            success: true,
            company: {
                name: result.companyName,
                domain: domain,
                profile: companyProfile
            },
            teamMembers: savedMembers.length > 0 ? savedMembers : result.teamMembers.map(m => ({
                ...m,
                id: null, // Not saved yet
                status: 'discovered'
            })),
            pageCount: result.pageCount
        };

        // Send final data
        res.write(`data: ${JSON.stringify({ type: 'complete', data: responseData })}\n\n`);
        res.end();

    } catch (e) {
        console.error('[Manual Research] Error:', e);
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
            res.end();
        }
    }
});

// Get team members for a company
app.get('/api/companies/:domain/team', requireAuth, async (req, res) => {
    try {
        const { domain } = req.params;

        const { rows } = await query(
            `SELECT id, person_name, job_title, linkedin_url, email, status, is_decision_maker, enrichment_data, created_at
             FROM company_team_members
             WHERE user_id = $1 AND company_domain = $2
             ORDER BY is_decision_maker DESC, created_at ASC`,
            [req.userId, domain]
        );

        res.json({ teamMembers: rows });
    } catch (e) {
        console.error('[Team Members] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Enrich a single team member via Google search
app.post('/api/companies/team/:id/enrich', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // Get team member
        const { rows } = await query(
            'SELECT * FROM company_team_members WHERE id = $1 AND user_id = $2',
            [id, req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Team member not found' });
        }

        const member = rows[0];

        // Update status to enriching
        await query(
            'UPDATE company_team_members SET status = $1, updated_at = NOW() WHERE id = $2',
            ['enriching', id]
        );

        // Run enrichment
        const enrichment = await enrichContact(member.person_name, member.company_name);

        // Update with results
        const newStatus = (enrichment.linkedin || enrichment.email) ? 'enriched' : 'discovered';

        await query(
            `UPDATE company_team_members 
             SET linkedin_url = COALESCE($1, linkedin_url),
                 email = COALESCE($2, email),
                 enrichment_data = $3,
                 status = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [enrichment.linkedin, enrichment.email, JSON.stringify(enrichment), newStatus, id]
        );

        res.json({
            success: true,
            linkedin: enrichment.linkedin,
            email: enrichment.email,
            status: newStatus
        });

    } catch (e) {
        console.error('[Enrichment] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Batch enrich multiple team members
app.post('/api/companies/team/enrich-batch', requireAuth, async (req, res) => {
    try {
        const { memberIds } = req.body;

        if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
            return res.status(400).json({ error: 'memberIds array is required' });
        }

        // Get team members with company domain
        const { rows } = await query(
            `SELECT id, person_name, company_name, company_domain FROM company_team_members 
             WHERE id = ANY($1) AND user_id = $2`,
            [memberIds, req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No team members found' });
        }

        // Mark as enriching
        await query(
            `UPDATE company_team_members SET status = 'enriching', updated_at = NOW() WHERE id = ANY($1)`,
            [memberIds]
        );

        // Run batch enrichment
        const contacts = rows.map(r => ({
            id: r.id,
            name: r.person_name,
            companyName: r.company_name,
            companyDomain: r.company_domain
        }));

        const results = await enrichContactsBatch(contacts);

        // Update each member
        for (const result of results) {
            const newStatus = (result.linkedin || result.email) ? 'enriched' : 'discovered';

            await query(
                `UPDATE company_team_members 
                 SET linkedin_url = COALESCE($1, linkedin_url),
                     email = COALESCE($2, email),
                     enrichment_data = $3,
                     status = $4,
                     updated_at = NOW()
                 WHERE id = $5`,
                [result.linkedin, result.email, JSON.stringify(result), newStatus, result.id]
            );
        }

        res.json({
            success: true,
            enriched: results.filter(r => r.linkedin || r.email).length,
            total: results.length,
            results: results.map(r => ({
                id: r.id,
                name: r.name,
                linkedin: r.linkedin,
                email: r.email
            }))
        });

    } catch (e) {
        console.error('[Batch Enrichment] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Convert team member to lead
app.post('/api/companies/team/:id/convert', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { icpId } = req.body;

        // Get team member
        const { rows } = await query(
            'SELECT * FROM company_team_members WHERE id = $1 AND user_id = $2',
            [id, req.userId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Team member not found' });
        }

        const member = rows[0];

        // Generate outreach if LinkedIn is available
        let outreachMessages = {};
        if (member.linkedin_url) {
            try {
                const { OutreachService } = await import('./src/backend/services/outreach-service.js');
                outreachMessages = await OutreachService.createLeadMessages({
                    first_name: member.person_name?.split(' ')[0],
                    company_name: member.company_name,
                    company_profile: '' // Could fetch from company if stored
                });
            } catch (e) {
                console.warn('[Convert] Outreach generation failed:', e.message);
            }
        }

        // Create lead
        const customData = {
            company_website: member.company_domain,
            source: 'manual_research',
            enrichment_data: member.enrichment_data,
            connection_request: outreachMessages.linkedin_message || null,
            email_message: outreachMessages.email_body || null
        };

        const leadResult = await query(
            `INSERT INTO leads (user_id, company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, icp_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'NEW', $7, 'Manual Research', $8)
             RETURNING id`,
            [
                req.userId,
                member.company_name,
                member.person_name,
                member.email,
                member.job_title,
                member.linkedin_url,
                JSON.stringify(customData),
                icpId || null
            ]
        );

        // Update team member status
        await query(
            'UPDATE company_team_members SET status = $1, updated_at = NOW() WHERE id = $2',
            ['converted', id]
        );

        res.json({
            success: true,
            leadId: leadResult.rows[0].id,
            hasOutreach: !!outreachMessages.linkedin_message
        });

    } catch (e) {
        console.error('[Convert] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Add team member manually (when website doesn't have team page)
app.post('/api/companies/:domain/team/add', requireAuth, async (req, res) => {
    try {
        const { domain } = req.params;
        const { name, title, companyName } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const result = await query(
            `INSERT INTO company_team_members 
             (user_id, company_name, company_domain, person_name, job_title, is_decision_maker, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'discovered')
             RETURNING id, person_name, job_title, is_decision_maker, status`,
            [req.userId, companyName || domain, domain, name, title || 'Unknown Role', isDecisionMaker(title)]
        );

        res.json({
            success: true,
            member: result.rows[0]
        });

    } catch (e) {
        console.error('[Add Team Member] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- ICP & CLEANUP ---

import { CompanyScorer } from './src/backend/services/company-scorer.js';

app.post('/api/strategies/:id/cleanup', requireAuth, async (req, res) => {
    const { id } = req.params;

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        const { rows } = await query('SELECT name FROM icps WHERE id = $1', [id]);
        if (rows.length === 0) {
            res.write(`data: ${JSON.stringify({ error: 'ICP not found' })}\n\n`);
            return res.end();
        }

        const icpName = rows[0].name;

        // Run cleanup with progress callback
        const result = await CompanyScorer.cleanupICP(id, icpName, (progress) => {
            // Stream progress update
            res.write(`data: ${JSON.stringify({ type: 'progress', stats: progress })}\n\n`);
        });

        // Final success message
        res.write(`data: ${JSON.stringify({ type: 'complete', success: true, stats: result })}\n\n`);
        res.end();

    } catch (e) {
        console.error('Cleanup Failed:', e);
        res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
        res.end();
    }
});

app.post('/api/admin/refactor-icps', async (req, res) => {
    try {
        console.log('🔄 Refactoring ICPs via API...');
        const fundsRes = await query(`
            SELECT id, name FROM icps 
            WHERE name ILIKE '%Funds%' AND name ILIKE '%Family Offices%'
        `);

        let renamed = 0;
        if (fundsRes.rows.length > 0) {
            for (const icp of fundsRes.rows) {
                await query(`
                    UPDATE icps 
                    SET name = 'Investment Firms', updated_at = NOW() 
                    WHERE id = $1
                `, [icp.id]);
                renamed++;
            }
        }

        const familyRes = await query(`
            SELECT id, name FROM icps 
            WHERE name = 'Family Offices' OR name = 'Family Office'
        `);

        let created = false;
        if (familyRes.rows.length === 0) {
            const userRes = await query('SELECT id FROM users LIMIT 1');
            if (userRes.rows.length > 0) {
                await query(`
                    INSERT INTO icps (user_id, name, config, agent_config)
                    VALUES ($1, 'Family Offices', '{}', '{}')
                `, [userRes.rows[0].id]);
                created = true;
            }
        }

        res.json({ success: true, renamed, created });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// 5. List Knowledge Base Files
app.get('/api/knowledge/files', requireAuth, async (req, res) => {
    try {
        // Get Default Vector Store ID for this user
        const { rows } = await query("SELECT value FROM system_config WHERE user_id = $1 AND key = 'default_vector_store'", [req.userId])
        if (rows.length === 0 || !rows[0].value?.id) {
            return res.json({ files: [] })
        }
        const vectorStoreId = rows[0].value.id

        // Fetch Files from OpenAI Vector Store
        // 1. List VS Files to get File IDs
        const vsFilesRes = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'OpenAI-Beta': 'assistants=v2'
            }
        })

        if (!vsFilesRes.ok) {
            throw new Error("Failed to fetch VS files")
        }
        const vsFilesData = await vsFilesRes.json()
        const fileIds = vsFilesData.data.map(f => f.id)

        if (fileIds.length === 0) {
            return res.json({ files: [] })
        }

        // 2. Fetch File Details (names) for each ID
        // Note: OpenAI doesn't have a bulk get files endpoint, so we might need to list all files
        // or fetch individually. Listing all files is safer.
        const allFilesRes = await fetch(`https://api.openai.com/v1/files`, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
        })
        const allFilesData = await allFilesRes.json()

        // Filter to only those in our VS
        const relevantFiles = allFilesData.data
            .filter(f => fileIds.includes(f.id))
            .map(f => ({
                id: f.id,
                name: f.filename,
                size: f.bytes,
                created_at: f.created_at
            }))

        res.json({ files: relevantFiles })
    } catch (err) {
        console.error('Failed to list KB files:', err)
        // Return empty on error to not break UI
        res.json({ files: [] })
    }
})

// Get CRM Columns
app.get('/api/crm-columns', requireAuth, async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM crm_columns WHERE user_id = $1 ORDER BY created_at ASC', [req.userId])
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch columns:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Save CRM Columns
app.post('/api/crm-columns', requireAuth, async (req, res) => {
    const { columns } = req.body
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'Invalid data' })
    try {
        await query('BEGIN')
        await query('DELETE FROM crm_columns WHERE user_id = $1', [req.userId])
        for (const col of columns) {
            await query(
                `INSERT INTO crm_columns (column_name, column_type, is_required, user_id) VALUES ($1, $2, $3, $4)`,
                [col.name, col.type, col.required, req.userId]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save columns:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Temporary Debug Endpoint - Review Required
app.get('/api/debug/review-required', async (req, res) => {
    try {
        // Find companies with REVIEW_REQUIRED status
        const { rows } = await query(`
            SELECT id, company_name, website, icp_type, fit_score, status, cleanup_status, data_quality_flags
            FROM companies 
            WHERE cleanup_status = 'REVIEW_REQUIRED'
            ORDER BY company_name ASC
        `);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- LEADS & CRM ---

// Get ALL Companies (For Companies View)
app.get('/api/companies', requireAuth, async (req, res) => {
    try {
        const { icpId, sort } = req.query;
        console.log('[GET /api/companies] User:', req.userId, 'ICP Filter:', icpId || 'none', 'Sort:', sort || 'fit');

        let queryText = `
            SELECT 
                c.*,
                COUNT(l.id) as lead_count
            FROM companies c
            LEFT JOIN leads l ON c.company_name = l.company_name AND c.user_id = l.user_id
            WHERE c.user_id = $1
        `;
        const params = [req.userId];

        // ICP Filter - check the company's icp_type OR lead's icp_id
        if (icpId) {
            // Get the ICP name to determine which icp_types to filter
            const { rows: icpRows } = await query('SELECT name FROM icps WHERE id = $1', [icpId]);
            const icpName = icpRows[0]?.name?.toLowerCase() || '';

            // Map ICP name to company icp_types
            if (icpName.includes('family office')) {
                // STRICT: Only show actual Family Offices for Family Office strategy
                queryText += ` AND c.icp_type IN ('FAMILY_OFFICE_SINGLE', 'FAMILY_OFFICE_MULTI')`;
            } else if (icpName.includes('fund') || icpName.includes('investment firm')) {
                // Show investment-related types for Funds/Investment Firms strategy
                // ALSO include companies with NULL icp_type (unclassified) OR those with leads under this ICP
                // FILTER OUT low-quality matches (score < 4) unless explicitly KEPT
                queryText += ` AND (
                    (
                        c.icp_type IN (
                            'REAL_ESTATE_PRIVATE_EQUITY', 
                            'ASSET_MANAGER_MULTI_STRATEGY',
                            'PENSION',
                            'SOVEREIGN_WEALTH_FUND',
                            'INSURANCE_INVESTOR',
                            'REIT_PUBLIC',
                            'RE_DEVELOPER_OPERATOR',
                            'REAL_ESTATE_DEBT_FUND',
                            'BANK_LENDER',
                            'PLATFORM_FRACTIONAL'
                        )
                        OR (
                            c.icp_type IS NULL
                            AND EXISTS (
                                SELECT 1 FROM leads 
                                WHERE company_name = c.company_name 
                                AND user_id = c.user_id 
                                AND icp_id = $2
                            )
                        )
                    )
                    AND (COALESCE(c.fit_score, 0) >= 6 OR c.cleanup_status = 'KEPT')
                )`;
                params.push(icpId);
            } else {
                // Fallback: filter by lead icp_id if icp_type not set
                queryText += ` AND (
                    c.icp_type IS NOT NULL 
                    OR EXISTS (
                        SELECT 1 FROM leads 
                        WHERE company_name = c.company_name 
                        AND user_id = c.user_id 
                        AND icp_id = $2
                    )
                )`;
                params.push(icpId);
            }
        }

        // Sort handling
        queryText += ` GROUP BY c.id `;

        if (sort === 'newest') {
            queryText += ` ORDER BY COALESCE(c.last_updated, c.created_at) DESC, c.company_name ASC`;
        } else {
            // Default: Fit Score
            queryText += ` ORDER BY c.fit_score DESC NULLS LAST, c.created_at DESC`;
        }

        const { rows } = await query(queryText, params);
        console.log(`[GET /api/companies] Found ${rows.length} rows.`);

        res.json({ companies: rows });
    } catch (e) {
        console.error('Failed to fetch companies:', e);
        res.status(500).json({ error: e.message });
    }
});

// Delete Company and its Leads
app.delete('/api/companies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Delete associated leads
        // First get company name to delete leads by name if needed, but we can delete by joins if we had foreign keys.
        // reliably, leads are linked by company_name AND user_id. 
        // Let's get the company details first.
        const { rows } = await query('SELECT * FROM companies WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Company not found' });
        }
        const company = rows[0];

        // Delete leads
        await query('DELETE FROM leads WHERE company_name = $1 AND user_id = $2', [company.company_name, req.userId]);

        // Delete company
        await query('DELETE FROM companies WHERE id = $1 AND user_id = $2', [id, req.userId]);

        res.json({ message: 'Company and leads deleted' });
    } catch (e) {
        console.error('Failed to delete company:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get Leads with Pagination
app.get('/api/leads', requireAuth, async (req, res) => {
    const { status, icpId, page = 1, pageSize = 100 } = req.query;

    try {
        // Parse and validate pagination params
        const pageNum = Math.max(1, parseInt(page) || 1);
        const pageSizeNum = Math.min(500, Math.max(1, parseInt(pageSize) || 100)); // Max 500 per page for performance
        const offset = (pageNum - 1) * pageSizeNum;

        // Build base query
        let queryStr = `
            SELECT leads.*,
            companies.company_profile as company_profile_text,
            companies.fit_score as company_fit_score
            FROM leads 
            LEFT JOIN companies ON leads.company_name = companies.company_name AND leads.user_id = companies.user_id
            WHERE leads.user_id = $1
            `;
        const params = [req.userId];
        let countParams = [req.userId];

        if (status) {
            queryStr += ' AND leads.status = $' + (params.length + 1);
            params.push(status);
            countParams.push(status);
        } else {
            // Default: Hide disqualified
            queryStr += " AND leads.status != 'DISQUALIFIED'";
        }

        if (icpId) {
            queryStr += ' AND leads.icp_id = $' + (params.length + 1);
            params.push(icpId);
            countParams.push(icpId);
        }

        // Get total count for pagination metadata
        // For count, we can just count leads, join shouldn't change count unless we filter by company props (which we don't for now)
        const countQuery = `SELECT COUNT(*) FROM leads WHERE leads.user_id = $1 ${status ? 'AND leads.status = $2' : "AND leads.status != 'DISQUALIFIED'"} ${icpId ? 'AND leads.icp_id = $' + (status ? 3 : 2) : ''} `;
        const { rows: countRows } = await query(countQuery, countParams);

        // Note: The simple countQuery above is safer than replacing 'SELECT *' because of the join syntax complexity

        const totalCount = parseInt(countRows[0].count);
        const totalPages = Math.ceil(totalCount / pageSizeNum);

        // Add pagination
        queryStr += ` ORDER BY leads.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2} `;
        params.push(pageSizeNum, offset);

        const { rows } = await query(queryStr, params);

        // Get total unique companies count (for dashboard stats)
        const uniqueCompanyQuery = `SELECT COUNT(DISTINCT company_name) as count FROM leads WHERE user_id = $1`;
        const { rows: uniqueCompanyRows } = await query(uniqueCompanyQuery, [req.userId]);
        const uniqueCompanies = parseInt(uniqueCompanyRows[0]?.count || 0);

        // Return data with pagination metadata
        res.json({
            data: rows,
            pagination: {
                page: pageNum,
                pageSize: pageSizeNum,
                total: totalCount,
                totalPages: totalPages,
                hasNext: pageNum < totalPages,
                hasPrevious: pageNum > 1
            },
            uniqueCompanies // Added for CRM stats
        });
    } catch (err) {
        console.error('Failed to fetch leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Approve Lead (Restore from Logbook)
app.post('/api/leads/:id/approve', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Reason required' });
    try {
        // 1. Fetch Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

        let lead = rows[0];

        await query(
            `INSERT INTO lead_feedback(lead_id, user_id, reason, original_status, new_status) VALUES($1, $2, $3, $4, 'NEW')`,
            [id, req.userId, reason, lead.status]
        );

        // 2. Generate Outreach
        // Need configs to get custom instructions
        const promptRes = await query('SELECT system_prompt FROM agent_prompts WHERE agent_id = $1 AND user_id = $2', ['outreach_creator', req.userId]);
        const customInstructions = promptRes.rows[0]?.system_prompt;

        const runner = new Runner();
        const agent = createOutreachAgent(customInstructions); // Tools default to empty for now
        const service = new OutreachService(runner);

        // Normalize lead for Agent
        const leadForAgent = {
            date_added: new Date().toISOString(),
            first_name: lead.person_name?.split(' ')[0] || '',
            last_name: lead.person_name?.split(' ').slice(1).join(' ') || '',
            company_name: lead.company_name,
            title: lead.job_title,
            email: lead.email,
            linkedin_url: lead.linkedin_url,
            company_website: lead.custom_data?.company_website || '',
            company_profile: lead.custom_data?.company_profile || ''
        };

        console.log(`Generating outreach for approved lead ${id}...`);
        const enrichedLeads = await service.generateOutreach([leadForAgent], agent, (msg) => console.log(`[Approval] ${msg}`));

        let updates = { status: 'NEW', source_notes: 'Approved from Logbook' };
        if (enrichedLeads.length > 0) {
            const result = enrichedLeads[0];
            if (result.email_message) updates.email_message = result.email_message;
            if (result.connection_request) updates.connection_request = result.connection_request;
        }

        // 3. Update DB
        // Update status
        await query('UPDATE leads SET status = $1 WHERE id = $2', ['NEW', id]);

        // Update custom_data with message
        if (enrichedLeads.length > 0) {
            const r = enrichedLeads[0];
            const newCustomData = {
                ...lead.custom_data,
                email_message: r.email_message,
                connection_request: r.connection_request,
                restored_at: new Date().toISOString()
            };
            await query('UPDATE leads SET custom_data = $1 WHERE id = $2', [newCustomData, id]);
        }

        res.json({ success: true });

    } catch (err) {
        console.error('Approval failed:', err);
        res.status(500).json({ error: 'Approval failed' });
    }
});

// Create/Update Lead
app.post('/api/leads', requireAuth, async (req, res) => {
    const { leads } = req.body // Array of leads
    if (!Array.isArray(leads)) return res.status(400).json({ error: 'Invalid data' })

    try {
        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
                 VALUES($1, $2, $3, $4, $5, 'NEW', $6, $7, $8)`,
                [
                    lead.company_name,
                    lead.first_name ? `${lead.first_name} ${lead.last_name}` : lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data || {}),
                    'Automation',
                    req.userId
                ]
            )
        }
        await query('COMMIT')
        res.json({ success: true, count: leads.length })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Delete Lead
// Toggle Lead Outreach Status
app.post('/api/leads/:leadId/pushed', requireAuth, async (req, res) => {
    try {
        const { leadId } = req.params;
        const { pushed } = req.body;

        await query(
            'UPDATE leads SET pushed_to_outreach = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
            [pushed, leadId, req.userId]
        );

        res.json({ success: true, pushed_to_outreach: pushed });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/leads/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    try {
        await query('DELETE FROM leads WHERE id = $1 AND user_id = $2', [id, req.userId])
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to delete lead:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Clear All Leads
app.post('/api/leads/clear', requireAuth, async (req, res) => {
    try {
        await query('DELETE FROM leads WHERE user_id = $1', [req.userId])
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to clear leads:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// --- WORKFLOW LOGGING ---

// Get Workflow Runs
app.get('/api/runs', requireAuth, async (req, res) => {
    try {
        // Fetch runs with their latest result (if any)
        const { rows } = await query(`
            SELECT 
                wr.*,
    ar.output_data,
    i.name as icp_name
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            LEFT JOIN icps i ON wr.icp_id = i.id
            WHERE wr.user_id = $1
            ORDER BY wr.started_at DESC
            LIMIT 50
    `, [req.userId])
        res.json(rows)
    } catch (err) {
        console.error('Failed to fetch runs:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Get Single Run Status (for resumption)
app.get('/api/runs/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await query(`
            SELECT 
                wr.*,
    ar.output_data
            FROM workflow_runs wr
            LEFT JOIN agent_results ar ON wr.id = ar.run_id
            WHERE wr.id = $1 AND wr.user_id = $2
    `, [id, req.userId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Run not found' });
        }

        const run = rows[0];

        // STALE RUN DETECTION: If status is RUNNING, check for staleness
        if (run.status === 'RUNNING') {
            const startedAt = new Date(run.started_at);
            const now = new Date();
            const runningMinutes = (now - startedAt) / (1000 * 60);

            // Check last log timestamp
            const logRes = await query(`
                SELECT MAX(created_at) as last_log_at 
                FROM workflow_step_logs 
                WHERE run_id = $1
    `, [id]);

            const lastLogAt = logRes.rows[0]?.last_log_at ? new Date(logRes.rows[0].last_log_at) : startedAt;
            const logAgeMinutes = (now - lastLogAt) / (1000 * 60);

            // Mark as STALE if: running > 10 min AND no logs in > 5 min
            if (runningMinutes > 10 && logAgeMinutes > 5) {
                console.log(`[Stale Detection]Run ${id} is stale(running ${runningMinutes.toFixed(1)} min, log age ${logAgeMinutes.toFixed(1)} min).Updating DB to FAILED...`);
                // Auto-mark as failed
                await query(
                    `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
                    [id, 'Run terminated unexpectedly (stale detection)']
                );
                console.log(`[Stale Detection]DB Updated for Run ${id}`);

                run.status = 'FAILED';
                run.error_log = 'Run terminated unexpectedly (stale detection)';
                run.was_stale = true;
            } else {
                // Return staleness info to frontend for UI feedback
                run.running_minutes = runningMinutes;
                run.log_age_minutes = logAgeMinutes;
            }
        }

        res.json(run);
    } catch (err) {
        console.error('Failed to fetch run:', err);
        res.status(500).json({ error: 'Database error' });
    }
})

// Helper to send SSE-like JSON chunks
const sendProgress = (res, message) => {
    res.write(`data: ${JSON.stringify({ type: 'progress', message })} \n\n`);
};

// Start Run
app.post('/api/runs/start', requireAuth, async (req, res) => {
    const { agent_id, metadata } = req.body
    try {
        const { rows } = await query(
            `INSERT INTO workflow_runs(agent_id, status, started_at, metadata, user_id) VALUES($1, 'RUNNING', NOW(), $2, $3) RETURNING id`,
            [agent_id, metadata, req.userId]
        )
        res.json({ run_id: rows[0].id })
    } catch (err) {
        console.error('Failed to start run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Complete Run (with results)
app.post('/api/runs/complete', async (req, res) => {
    const { run_id, output_data } = req.body
    try {
        await query('BEGIN')
        await query(
            `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW() WHERE id = $1`,
            [run_id]
        )
        // Store results if any
        if (output_data) {
            await query(
                `INSERT INTO agent_results(run_id, output_data) VALUES($1, $2)`,
                [run_id, output_data] // Storing full JSON blob
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to complete run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Fail Run
app.post('/api/runs/fail', async (req, res) => {
    const { run_id, error } = req.body
    try {
        await query(
            `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
            [run_id, error]
        )
        res.json({ success: true })
    } catch (err) {
        console.error('Failed to fail run:', err)
        res.status(500).json({ error: 'Database error' })
    }
})

// Trigger Analysis Run (The Long Running Process)
// --- APIFY INTEGRATION ---
import { startApolloDomainScrape, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';

// Auto-run Credit Migration on Startup (Safe idempotency)
(async () => {
    try {
        await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS credits INTEGER DEFAULT 500000; `);
        // Ensure admin user exists for testing
        await query(`
            INSERT INTO users(email, name, role, credits)
VALUES('admin@elvison.ai', 'Admin', 'admin', 500000)
            ON CONFLICT(email) DO UPDATE SET credits = 500000 WHERE users.credits IS NULL;
`);
        console.log("System: Credits system initialized.");
    } catch (e) {
        // console.error("System: Credit init informative", e); // Valid table exists
    }
})();

app.post('/api/integrations/apify/run', async (req, res) => {
    const { token, domains, filters } = req.body;

    // Allow system token fallback
    const effectiveToken = token || process.env.APIFY_API_TOKEN;

    if (!effectiveToken || !domains || !Array.isArray(domains)) {
        return res.status(400).json({ error: 'Valid Token (or System Env) and domains array required' });
    }

    // CREDIT CHECK
    try {
        const userRes = await query(`SELECT credits, id FROM users LIMIT 1`);
        const user = userRes.rows[0];
        if (user && user.credits <= 0) {
            return res.status(403).json({ error: 'Insufficient credits. Please upgrade.' });
        }
    } catch (e) {
        console.error("Credit check skipped due to DB error", e);
    }

    try {
        const runId = await startApolloDomainScrape(effectiveToken, domains, filters);
        res.json({ runId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/integrations/apify/status/:runId', async (req, res) => {
    const { runId } = req.params;
    const { token } = req.query; // Pass token in query for GET

    const effectiveToken = token || process.env.APIFY_API_TOKEN;

    if (!effectiveToken) return res.status(400).json({ error: 'Token required (User or System)' });

    try {
        const { status, datasetId } = await checkApifyRun(effectiveToken, runId);

        if (status === 'SUCCEEDED') {
            const items = await getApifyResults(effectiveToken, datasetId);

            // Auto-insert into DB
            let importedCount = 0;
            for (const item of items) {
                // Map fields based on PIPELINELABS output mapping
                // Output Schema: fullName, email, position, city, linkedinUrl, orgName

                // Parse Name
                let firstName = item.firstName || item.first_name;
                let lastName = item.lastName || item.last_name;
                if (!firstName && item.fullName) {
                    const parts = item.fullName.split(' ');
                    firstName = parts[0];
                    lastName = parts.slice(1).join(' ');
                }

                // Parse Email
                const email = item.email || item.workEmail || item.personalEmail;
                if (!email) continue;

                // Parse Company
                const companyName = item.orgName || item.companyName || item.company_name;

                try {
                    await query(
                        `INSERT INTO leads(
    first_name, last_name, title, company_name,
    email, linkedin_url, location, source, status
) VALUES($1, $2, $3, $4, $5, $6, $7, 'APIFY_IMPORT', 'NEW')
                        ON CONFLICT(email) DO NOTHING`,
                        [
                            firstName,
                            lastName,
                            item.position || item.title || item.jobTitle,
                            companyName,
                            email,
                            item.linkedinUrl || item.linkedin_url || item.profileUrl,
                            item.city || item.location,
                        ]
                    );
                    importedCount++;
                } catch (err) {
                    console.error('Insert error:', err);
                }
            }

            // DEDUCT CREDITS
            if (importedCount > 0) {
                try {
                    // deduct from the first user found (admin)
                    await query(`UPDATE users SET credits = credits - $1 WHERE id = (SELECT id FROM users LIMIT 1)`, [importedCount]);
                    console.log(`Deducted ${importedCount} credits.`);
                } catch (e) {
                    console.error("Credit deduction failed", e);
                }
            }

            return res.json({ status, importedCount, results: items });
        }

        res.json({ status });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ICP MANAGEMENT ENDPOINTS ---

// Get all ICPs for logged-in user
app.get('/api/icps', requireAuth, async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT * FROM icps WHERE user_id = $1 ORDER BY created_at DESC',
            [req.userId]
        )
        res.json({ icps: rows })
    } catch (err) {
        console.error('Failed to fetch ICPs:', err)
        res.status(500).json({ error: 'Failed to fetch ICPs' })
    }
})

// Create new ICP
app.post('/api/icps', requireAuth, async (req, res) => {
    const { name, config, agent_config } = req.body

    // Check limit
    try {
        const countRes = await query('SELECT COUNT(*) FROM icps WHERE user_id = $1', [req.userId])
        if (parseInt(countRes.rows[0].count) >= 3) {
            return res.status(403).json({ error: 'ICP limit reached (Max 3).' })
        }

        const { rows } = await query(
            `INSERT INTO icps(user_id, name, config, agent_config)
VALUES($1, $2, $3, $4)
RETURNING * `,
            [req.userId, name, config || {}, agent_config || {}]
        )
        res.json({ success: true, icp: rows[0] })
    } catch (err) {
        console.error('Failed to create ICP:', err)
        res.status(500).json({ error: 'Failed to create ICP' })
    }
})

// Update ICP
app.put('/api/icps/:id', requireAuth, async (req, res) => {
    const { id } = req.params
    const { name, config, agent_config } = req.body

    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId])
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' })

        // Build dynamic update
        // Simplify: just update provided fields
        const updates = []
        const values = []
        let idx = 1

        if (name) { updates.push(`name = $${idx++} `); values.push(name) }
        if (config) { updates.push(`config = $${idx++} `); values.push(config) }
        if (agent_config) { updates.push(`agent_config = $${idx++} `); values.push(agent_config) }

        if (updates.length > 0) {
            values.push(id) // ID is last param
            await query(
                `UPDATE icps SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING * `,
                values
            )
            const updatedRow = (await query('SELECT * FROM icps WHERE id = $1', [id])).rows[0]
            res.json({ success: true, icp: updatedRow })
        } else {
            const existing = await query('SELECT * FROM icps WHERE id = $1', [id])
            res.json({ success: true, icp: existing.rows[0] })
        }
    } catch (err) {
        console.error('Failed to update ICP:', err)
        res.status(500).json({ error: 'Failed to update ICP' })
    }
})

// --- FEEDBACK ENDPOINTS ---

app.post('/api/runs/:runId/feedback', requireAuth, async (req, res) => {
    const { runId } = req.params
    const { icpId, feedbacks } = req.body // feedbacks is array of { entity_type, entity_identifier, grade, notes }

    // Validate ownership of run?
    // For MVP, just insert.

    if (!feedbacks || !Array.isArray(feedbacks)) return res.status(400).json({ error: 'Invalid feedback format' });

    try {
        await query('BEGIN')
        for (const fb of feedbacks) {
            await query(
                `INSERT INTO run_feedback(run_id, icp_id, entity_type, entity_identifier, grade, notes)
VALUES($1, $2, $3, $4, $5, $6)`,
                [runId, icpId, fb.entity_type, fb.entity_identifier, fb.grade, fb.notes]
            )
        }
        await query('COMMIT')
        res.json({ success: true })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Failed to save feedback:', err)
        res.status(500).json({ error: 'Failed to save feedback' })
    }
})


// Trigger Optimization Loop
app.post('/api/icps/:id/optimize', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        const optimizer = new OptimizationService(req.userId, id);
        const result = await optimizer.optimize();
        res.json(result);
    } catch (err) {
        console.error('Optimization failed:', err);
        res.status(500).json({ error: 'Optimization failed', details: err.message });
    }
});

// --- SEARCH TERM MANAGEMENT ENDPOINTS ---
import { getOrderedTerms, addSearchTerms, removeSearchTerm, reorderSearchTerms, generateSearchTerms } from './src/backend/services/search-term-manager.js';

// Get search terms for an ICP
app.get('/api/icps/:id/search-terms', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' });

        const terms = await getOrderedTerms(id);
        res.json({ terms });
    } catch (err) {
        console.error('Failed to get search terms:', err);
        res.status(500).json({ error: 'Failed to get search terms' });
    }
});

// Add search terms to an ICP
app.post('/api/icps/:id/search-terms', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { terms } = req.body;

    if (!terms || !Array.isArray(terms)) {
        return res.status(400).json({ error: 'terms array required' });
    }

    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' });

        await addSearchTerms(id, terms);
        const updated = await getOrderedTerms(id);
        res.json({ success: true, terms: updated });
    } catch (err) {
        console.error('Failed to add search terms:', err);
        res.status(500).json({ error: 'Failed to add search terms' });
    }
});

// Reorder search terms
app.put('/api/icps/:id/search-terms/reorder', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { orderedTerms } = req.body;

    if (!orderedTerms || !Array.isArray(orderedTerms)) {
        return res.status(400).json({ error: 'orderedTerms array required' });
    }

    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' });

        await reorderSearchTerms(id, orderedTerms);
        const updated = await getOrderedTerms(id);
        res.json({ success: true, terms: updated });
    } catch (err) {
        console.error('Failed to reorder search terms:', err);
        res.status(500).json({ error: 'Failed to reorder search terms' });
    }
});

// Delete a search term
app.delete('/api/icps/:id/search-terms/:term', requireAuth, async (req, res) => {
    const { id, term } = req.params;

    try {
        // Verify ownership
        const verify = await query('SELECT id FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (verify.rows.length === 0) return res.status(404).json({ error: 'ICP not found' });

        await removeSearchTerm(id, decodeURIComponent(term));
        const updated = await getOrderedTerms(id);
        res.json({ success: true, terms: updated });
    } catch (err) {
        console.error('Failed to delete search term:', err);
        res.status(500).json({ error: 'Failed to delete search term' });
    }
});

// Generate AI search terms from ICP description
app.post('/api/icps/:id/search-terms/generate', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { count = 20 } = req.body;

    try {
        // Verify ownership and get ICP config
        const icpRes = await query('SELECT id, config FROM icps WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (icpRes.rows.length === 0) return res.status(404).json({ error: 'ICP not found' });

        const config = icpRes.rows[0].config || {};
        const icpDescription = config.surveys?.company_finder?.icp_description ||
            config.icp_description ||
            config.description ||
            '';

        if (!icpDescription) {
            return res.status(400).json({ error: 'ICP has no description to generate terms from' });
        }

        const terms = await generateSearchTerms(icpDescription, count);

        if (terms.length > 0) {
            await addSearchTerms(id, terms);
        }

        const updated = await getOrderedTerms(id);
        res.json({ success: true, generated: terms.length, terms: updated });
    } catch (err) {
        console.error('Failed to generate search terms:', err);
        res.status(500).json({ error: 'Failed to generate search terms' });
    }
});


// Trigger Analysis Run (SSE Streaming)
// Trigger Analysis Run (SSE Streaming)
app.post('/api/agents/run', requireAuth, async (req, res) => {
    let { prompt, vectorStoreId, agentConfigs, mode, filters, idempotencyKey, icpId, manualDomains } = req.body
    console.log(`Starting live workflow(Mode: ${mode || 'default'}) with prompt: `, prompt)
    if (idempotencyKey) console.log(`🔑 Idempotency Key received: ${idempotencyKey} `)
    if (icpId) console.log(`📋 Running for ICP ID: ${icpId} `)

    // 1. Setup SSE Headers IMMEDIATE (Fixes latency)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    })
    res.write(`: connecting\n\n`) // Flush buffer immediately

    let runId = null;
    try {
        // 2. Parallelize Setup Queries (Fixes latency)
        const queries = [
            // Q1: Get ICP Data if needed
            icpId ? query('SELECT name, agent_config FROM icps WHERE id = $1', [icpId]) : Promise.resolve({ rows: [] }),
            // Q2: Get Max Run Number
            icpId
                ? query('SELECT MAX(run_number) as max_num FROM workflow_runs WHERE icp_id = $1', [icpId])
                : query('SELECT MAX(run_number) as max_num FROM workflow_runs WHERE user_id = $1 AND icp_id IS NULL', [req.userId])
        ];

        const [icpRes, countRes] = await Promise.all(queries);

        // 3. Process ICP Config & Run Meta
        let runName = `Run ${new Date().toLocaleTimeString()} `; // Fallback
        let runNumber = (countRes.rows[0]?.max_num || 0) + 1;

        if (icpId && icpRes.rows.length > 0) {
            const icpData = icpRes.rows[0];
            runName = `${icpData.name || 'Unknown ICP'} #${runNumber} `;

            // Apply ICP Optimizations
            const storedConfig = icpData.agent_config || {};
            if (storedConfig.optimized_instructions) {
                if (!agentConfigs) agentConfigs = {};
                agentConfigs['company_finder'] = {
                    ...agentConfigs['company_finder'],
                    instructions: storedConfig.optimized_instructions
                };
                if (storedConfig.exclusions && Array.isArray(storedConfig.exclusions)) {
                    prompt += `\n\n[OPTIMIZATION EXCLUSIONS]: \n${storedConfig.exclusions.join(', ')} `;
                }
                console.log("✅ Applied optimized instructions and exclusions from DB.");
            }
        } else if (!icpId) {
            runName = `Manual Run #${runNumber} `;
        }

        // 4. Create Run Record
        const { rows } = await query(
            `INSERT INTO workflow_runs(agent_id, status, started_at, metadata, user_id, icp_id, run_name, run_number)
             VALUES('main_workflow', 'RUNNING', NOW(), $1, $2, $3, $4, $5) RETURNING id`,
            [JSON.stringify({ prompt, vectorStoreId, mode: mode || 'default', idempotencyKey }), req.userId, icpId, runName, runNumber]
        )
        runId = rows[0].id

        // 5. Send Run ID (Client can now verify run started)
        res.write(`event: run_id\ndata: ${JSON.stringify({ runId })} \n\n`)
        res.write(`event: log\ndata: { "step": "System", "detail": "Workflow initialized. Run ID: ${runId}", "timestamp": "${new Date().toISOString()}" } \n\n`)

    } catch (err) {
        console.error('Failed to init run:', err)
        res.write(`event: error\ndata: { "message": "Database initialization failed: ${err.message}" } \n\n`)
        return res.end()
    }

    // 6. Execute Workflow... (rest of the function continues below)

    // 3. Execute Workflow with Streaming Listeners
    const localExecutionLogs = []; // Capture logs for persistence
    try {
        const result = await runAgentWorkflow({ input_as_text: prompt }, {
            runId: runId,
            vectorStoreId: vectorStoreId,
            userId: req.userId,
            icpId: icpId,
            // Dynamic Target Extraction from Prompt
            targetLeads: req.body.targetLeads || (() => {
                const match = prompt.match(/(?:find|get|scrape|target|need)\s*(\d+)\s*(?:leads|contacts|companies|prospects|records)/i);
                return match ? parseInt(match[1]) : 50;
            })(),
            maxLeadsPerCompany: req.body.maxLeadsPerCompany || (() => {
                const match = prompt.match(/(\d+)\s*(?:decision makers|leads|contacts|people)\s*per\s*(?:firm|company|office)/i);
                return match ? parseInt(match[1]) : 3;
            })(),
            agentConfigs: agentConfigs || {},
            mode: mode,
            filters: filters || {},
            idempotencyKey: idempotencyKey,
            manualDomains: manualDomains,
            listeners: {
                onLog: async (logParams) => {
                    const timestamp = new Date().toISOString();
                    const eventData = JSON.stringify({
                        step: logParams.step,
                        detail: logParams.detail,
                        timestamp
                    })
                    res.write(`event: log\ndata: ${eventData} \n\n`)

                    // Capture for DB persistence (final save)
                    localExecutionLogs.push({
                        timestamp,
                        stage: logParams.step,
                        message: logParams.detail,
                        status: 'INFO',
                        details: logParams
                    });

                    // REAL-TIME: Also persist to workflow_step_logs table immediately
                    try {
                        await query(
                            `INSERT INTO workflow_step_logs(run_id, step, message, created_at) VALUES($1, $2, $3, $4)`,
                            [runId, logParams.step, logParams.detail, timestamp]
                        );
                    } catch (logDbErr) {
                        console.error('Step log persist failed:', logDbErr.message);
                    }
                }
            }
        })

        // SUCCESS PATH: Save logs, stats, and output to database
        console.log('Workflow completed successfully, saving results...');

        try {
            // Build stats object from workflow result
            const workflowStats = result.stats || {};
            const costData = workflowStats.cost || {};

            // Build comprehensive stats object for DB storage
            const statsForDB = {
                // CRITICAL: Spread all workflow stats first (includes qualified, leadsDisqualified, searchStats, companies_discovered)
                ...workflowStats,

                // Override with specific fields that need formatting
                leads_returned: result.leads?.length || workflowStats.leads_returned || 0,

                // Cost data (from CostTracker.getSummary())
                cost: costData.cost || { total: 0, formatted: '$0.00' },
                tokens: costData.tokens || { input: 0, output: 0, total: 0 },
                breakdown: costData.breakdown || { byAgent: {}, byModel: {} },
                calls: costData.calls || [],
                totalCalls: costData.totalCalls || 0,

                // Execution timeline logs
                execution_timeline: localExecutionLogs,
                execution_logs: localExecutionLogs
            };

            console.log(`[Server] Saving stats with ${localExecutionLogs.length} log entries and ${statsForDB.calls?.length || 0} API calls`);

            // Save output to agent_results
            const outputDataForStorage = {
                leads: result.leads || [],
                status: result.status,
                execution_logs: localExecutionLogs,
                execution_timeline: localExecutionLogs
            };

            // Delete existing result if any, then insert (no unique constraint on run_id)
            await query(`DELETE FROM agent_results WHERE run_id = $1`, [runId]);
            await query(
                `INSERT INTO agent_results(run_id, output_data) VALUES($1, $2)`,
                [runId, JSON.stringify(outputDataForStorage)]
            );

            // Update workflow_runs with stats
            await query(
                `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = NOW(), stats = $2 WHERE id = $1`,
                [runId, JSON.stringify(statsForDB)]
            );

            // Send success event
            res.write(`event: complete\ndata: ${JSON.stringify({
                status: 'success',
                leads: result.leads?.length || 0,
                cost: costData.cost?.formatted || '$0.00'
            })
                } \n\n`);

        } catch (dbErr) {
            console.error('Failed to save success results:', dbErr);
            res.write(`event: error\ndata: { "message": "Results saved but DB commit failed: ${dbErr.message}" } \n\n`);
        }


    } catch (error) {
        console.error('Workflow failed:', error);

        // CRITICAL: Extract cost data from error.stats (attached by workflow.js catch block)
        const errorStats = error.stats || {};
        const costData = errorStats.cost || {};

        // Build comprehensive stats object for DB storage (same structure as success path)
        const statsForDB = {
            ...errorStats, // CRITICAL: Preserve partial stats like companies_discovered
            partialStats: true,
            error: error.message,
            // Cost data (from CostTracker.getSummary() attached to error)
            cost: costData.cost || { total: 0, formatted: '$0.00' },
            tokens: costData.tokens || { input: 0, output: 0, total: 0 },
            breakdown: costData.breakdown || { byAgent: {}, byModel: {} },
            calls: costData.calls || [],
            totalCalls: costData.totalCalls || 0,
            // Execution timeline logs
            execution_timeline: localExecutionLogs,
            execution_logs: localExecutionLogs
        };

        console.log(`[Server] Saving FAILURE stats with ${localExecutionLogs.length} log entries and ${statsForDB.calls?.length || 0} API calls`);

        try {
            if (runId) {
                // Save whatever logs we captured before failure
                const outputDataForStorage = {
                    execution_logs: localExecutionLogs,
                    execution_timeline: localExecutionLogs,
                    error: error.message
                };

                // Delete existing result if any, then insert (no unique constraint on run_id)
                await query(`DELETE FROM agent_results WHERE run_id = $1`, [runId]);
                await query(
                    `INSERT INTO agent_results(run_id, output_data) VALUES($1, $2)`,
                    [runId, JSON.stringify(outputDataForStorage)]
                );

                await query(
                    `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2, stats = $3 WHERE id = $1`,
                    [runId, error.message || String(error), JSON.stringify(statsForDB)]
                );
            }
        } catch (dbErr) {
            console.error("DB update failed during error handling", dbErr);
        }

        res.write(`event: error\ndata: { "message": "${error.message || 'Workflow execution failed'}" } \n\n`);
    } finally {
        res.end();
    }
})

/**
 * Workflow Cancellation Endpoint
 * Updates run status to CANCELLED, which worker polls
 */
app.post('/api/workflow/cancel', requireAuth, async (req, res) => {
    const { runId } = req.body;
    if (!runId) return res.status(400).json({ error: "Missing runId" });

    try {
        await query(`UPDATE workflow_runs SET status = 'CANCELLED' WHERE id = $1`, [runId]);
        res.json({ status: 'success', message: 'Run cancellation signaled.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
})

/**
 * Force-Fail Endpoint
 * Manually marks a stuck/stale run as FAILED when the user wants to clear it
 */
app.post('/api/runs/:id/force-fail', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;

    try {
        // Verify ownership
        const verifyRes = await query('SELECT id, status FROM workflow_runs WHERE id = $1 AND user_id = $2', [id, req.userId]);
        if (verifyRes.rows.length === 0) {
            return res.status(404).json({ error: 'Run not found' });
        }

        const run = verifyRes.rows[0];

        // Allow force-failing RUNNING, PENDING, or FAILED (idempotent)
        // If it's already FAILED, we just return success to clear the UI state.
        if (run.status === 'FAILED') {
            return res.json({ status: 'success', message: 'Run is already marked as FAILED.' });
        }

        if (!['RUNNING', 'PENDING'].includes(run.status)) {
            return res.status(400).json({ error: `Cannot force - fail run with status: ${run.status} ` });
        }

        const errorMessage = reason || 'Manually stopped by user (force-fail)';

        await query(
            `UPDATE workflow_runs SET status = 'FAILED', completed_at = NOW(), error_log = $2 WHERE id = $1`,
            [id, errorMessage]
        );

        console.log(`[Force - Fail] Run ${id} manually marked as FAILED: ${errorMessage} `);
        res.json({ status: 'success', message: 'Run marked as failed.' });
    } catch (e) {
        console.error('Force-fail error:', e);
        res.status(500).json({ error: e.message });
    }
})

// 6. Get Run Logs (New)
app.get('/api/runs/:id/logs', requireAuth, async (req, res) => {
    const { id } = req.params;
    try {
        // Query step logs (real-time execution logs), not workflow_logs (API metrics)
        const { rows } = await query(`
            SELECT id, run_id, step, message, created_at FROM workflow_step_logs 
            WHERE run_id = $1 
            ORDER BY created_at ASC
        `, [id]);
        res.json({ logs: rows });
    } catch (e) {
        console.error("Failed to fetch logs:", e);
        res.status(500).json({ error: e.message });
    }
});

// Helper to format agent ID to Name
function formatAgentName(id) {
    return id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// List GoHighLevel Tags
app.get('/api/integrations/ghl/tags', requireAuth, async (req, res) => {
    try {
        const tags = await ghlService.listTags()
        res.json({ tags })
    } catch (err) {
        console.error('GHL tags error:', err)
        res.status(500).json({ error: 'Failed to fetch GoHighLevel tags' })
    }
})

// DEBUG: Test GHL Connection (Public)
app.get('/api/test-ghl', async (req, res) => {
    try {
        // Direct call to see headers and response
        const axios = (await import('axios')).default;
        const key = process.env.GHL_API_KEY;
        const locationId = process.env.GHL_LOCATION_ID || '5tJd1yCE13B3wwdy9qvl';

        console.log('Testing GHL with key length:', key?.length);

        const response = await axios.get(
            `https://services.leadconnectorhq.com/locations/${locationId}/tags`,
            {
                headers: {
                    'Authorization': `Bearer ${key?.trim()}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        res.json({
            success: true,
            tags: response.data.tags?.slice(0, 3),
            total: response.data.tags?.length,
            debug: {
                headers: response.config.headers['Authorization'] ? 'Bearer [HIDDEN]' : 'Missing',
                url: response.config.url
            }
        });
    } catch (err) {
        res.status(500).json({
            error: err.message,
            status: err.response?.status,
            data: err.response?.data,
            debug: {
                hasKey: !!process.env.GHL_API_KEY,
                locationId: process.env.GHL_LOCATION_ID
            }
        });
    }
});

// Create GoHighLevel Tag
app.post('/api/integrations/ghl/tags', requireAuth, async (req, res) => {
    const { name } = req.body

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tag name is required' })
    }

    try {
        const tag = await ghlService.createTag(name.trim())
        res.json({ success: true, tag })
    } catch (err) {
        console.error('GHL create tag error:', err)
        res.status(500).json({ error: 'Failed to create GoHighLevel tag' })
    }
})

// Push Leads to Outreach Tool
app.post('/api/integrations/push', requireAuth, async (req, res) => {
    const { tool, campaignId, leadIds } = req.body

    if (!tool || !campaignId || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'Missing required fields' })
    }

    try {
        // 1. Fetch Leads from DB
        const { rows: leads } = await query('SELECT * FROM leads WHERE id = ANY($1)', [leadIds])

        if (leads.length === 0) {
            return res.status(404).json({ error: 'No matching leads found' })
        }

        // 2. Respond immediately to prevent timeouts
        res.json({
            success: true,
            status: 'queued',
            count: leads.length,
            message: `Started pushing ${leads.length} leads to ${tool} in the background.`
        })

            // 3. Process in Background
            ; (async () => {
                console.log(`[Outreach] Background push started for ${leads.length} leads to ${tool}`);
                const results = { success: [], failed: [] };

                for (const lead of leads) {
                    try {
                        if (tool === 'aimfox') {
                            await aimfoxService.addLeadToCampaign(campaignId, lead)
                        } else if (tool === 'gohighlevel') {
                            // campaignId is actually the tag name for GHL
                            await ghlService.createContact(lead, null, campaignId)
                        }

                        // Update leads status locally
                        await query("UPDATE leads SET outreach_status = 'pushed', updated_at = NOW() WHERE id = $1", [lead.id])
                        results.success.push(lead.id)

                    } catch (err) {
                        console.error(`Failed to push lead ${lead.id} to ${tool}:`, err.message)
                        results.failed.push({ id: lead.id, error: err.message })
                        // Optional: Update status to 'failed_push'
                        await query("UPDATE leads SET outreach_status = 'failed_push', updated_at = NOW() WHERE id = $1", [lead.id])
                    }
                }
                console.log(`[Outreach] Background push complete. Success: ${results.success.length}, Failed: ${results.failed.length}`);
            })().catch(err => console.error('[Outreach] Background processing fatal error:', err));

    } catch (err) {
        console.error('Push integration error:', err)
        // Only redundant if response already sent, but safe here as we wait for SELECT
        if (!res.headersSent) res.status(500).json({ error: 'Integration push failed' })
    }
})

// --- Catch-All for Frontend ---
// Express 5 requires regex for global wildcard since '*' string is reserved
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// --- Database Initialization ---
const initDB = async () => {
    try {
        console.log('Initializing Database Schema...')

        // System Config
        await query(`
            CREATE TABLE IF NOT EXISTS system_config (
                key VARCHAR(50) PRIMARY KEY,
                value JSONB,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `)

        // Agent Prompts
        await query(`
            CREATE TABLE IF NOT EXISTS agent_prompts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                agent_id VARCHAR(50) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                system_prompt TEXT NOT NULL,
                config JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `)



        // Multi-ICP Tables
        await query(`
            CREATE TABLE IF NOT EXISTS icps(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    name VARCHAR(100) NOT NULL,
    config JSONB DEFAULT '{}':: jsonb,
    agent_config JSONB DEFAULT '{}':: jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`)

        await query(`
            CREATE TABLE IF NOT EXISTS run_feedback(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID REFERENCES workflow_runs(id),
    icp_id UUID REFERENCES icps(id),
    entity_type VARCHAR(50) NOT NULL,
    entity_identifier VARCHAR(255),
    grade VARCHAR(20),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
`);

        // Company Tracking Table (Migration 05)
        await query(`
            CREATE TABLE IF NOT EXISTS researched_companies (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
                company_name VARCHAR(255) NOT NULL,
                domain VARCHAR(255),
                status VARCHAR(50) DEFAULT 'researched', -- 'researched', 'contacted'
                lead_count INTEGER DEFAULT 0,
                metadata JSONB DEFAULT '{}'::jsonb,
                researched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                contacted_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(user_id, domain)
            );
            CREATE INDEX IF NOT EXISTS idx_researched_companies_user_id ON researched_companies(user_id);
            CREATE INDEX IF NOT EXISTS idx_researched_companies_domain ON researched_companies(domain);
        `);

        // Add columns to existing tables if needed
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id); `)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS icp_id UUID REFERENCES icps(id); `)

        // Migration: Add phone_numbers if not exists
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_numbers JSONB DEFAULT '[]'::jsonb;`)

        // Migration: Add stats column to workflow_runs for logbook metrics
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS stats JSONB;`)

        // Migration: Add source_notes column to leads table (used for disqualified leads tracking)
        await query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_notes TEXT;`)


        // Create Lead Feedback Table (Migration 06)
        await query(`
            CREATE TABLE IF NOT EXISTS lead_feedback (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id),
                reason TEXT NOT NULL,
    original_status VARCHAR(50),
                new_status VARCHAR(50),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_lead_feedback_lead_id ON lead_feedback(lead_id);
        `);

        // Migration: "Zombie Lead" Cleanup
        // DISABLED: This migration was TOO aggressive - it marked ALL leads without connection requests as zombies,
        // including high-quality VPs/EVPs that were recently imported and haven't had outreach yet.
        // TODO: Reimplement with proper filters:
        // - Only leads imported >30 days ago
        // - Must also lack email
        // - Skip if title contains VP/President/Director/CEO/CIO/COO
        /*
        const zombieRes = await query(`
            UPDATE leads 
            SET status = 'DISQUALIFIED', source_notes = 'Archived: No connection request sent (Zombie)'
            WHERE status = 'NEW' 
            AND (custom_data->>'connection_request' IS NULL OR custom_data->>'connection_request' = '')
            AND source != 'Import'
        `);
        if ( zombieRes.rowCount > 0) {
            console.log(`🧹 Migrated ${zombieRes.rowCount} zombie leads to DISQUALIFIED.`);
        }
        */

        // Migration 07: Logbook Enhancements (Granular Logs & naming)
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_name VARCHAR(255);`);
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS run_number INTEGER;`);

        await query(`
            CREATE TABLE IF NOT EXISTS workflow_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                run_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
                agent_name VARCHAR(100),
                model_name VARCHAR(100),
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cost DECIMAL(12, 6) DEFAULT 0,
                duration_seconds DECIMAL(10, 2),
                metadata JSONB DEFAULT '{}'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_workflow_logs_run_id ON workflow_logs(run_id);
        `);

        // Migration 09: Real-time Step Logs (separate from API metrics)
        await query(`
            CREATE TABLE IF NOT EXISTS workflow_step_logs (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                run_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
                step VARCHAR(100),
                message TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_workflow_step_logs_run_id ON workflow_step_logs(run_id);
        `);

        // Migration 08: Search Term Rotation
        await query(`ALTER TABLE icps ADD COLUMN IF NOT EXISTS search_terms JSONB DEFAULT '[]'::jsonb;`);
        await query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS search_stats JSONB DEFAULT '{}'::jsonb;`);
        await query(`CREATE INDEX IF NOT EXISTS idx_icps_search_terms ON icps USING gin(search_terms);`);

        // Migration 09: Add market_intelligence and last_researched_at columns
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS market_intelligence TEXT;`);
        await query(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_researched_at TIMESTAMP WITH TIME ZONE;`);

        console.log('Database Schema Verified.')
    } catch (err) {
        console.error('Failed to initialize DB:', err)
    }
}

// Enrich Lead (Phone)
app.post('/api/leads/:id/enrich-phone', requireAuth, async (req, res) => {
    const { id } = req.params
    try {
        // 1. Get Lead
        const { rows } = await query('SELECT * FROM leads WHERE id = $1', [id])
        if (rows.length === 0) return res.status(404).json({ error: 'Lead not found' })

        const lead = rows[0]
        // Parse name
        const nameParts = (lead.person_name || '').split(' ')
        const leadData = {
            first_name: nameParts[0],
            last_name: nameParts.slice(1).join(' '),
            company_name: lead.company_name,
            email: lead.email,
            linkedin_url: lead.linkedin_url
        }

        // 2. Call Agent
        console.log(`Enriching lead ${id} (${leadData.email})...`)
        const phoneNumbers = await enrichLeadWithPhone(leadData)
        console.log('Enrichment result:', phoneNumbers)

        // 3. Update DB
        const { rows: updatedRows } = await query(
            `UPDATE leads SET phone_numbers = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [JSON.stringify(phoneNumbers), id]
        )

        res.json({ success: true, lead: updatedRows[0] })
    } catch (err) {
        console.error('Enrichment failed:', err)
        res.status(500).json({ error: 'Enrichment failed' })
    }
})

const upload = multer({ storage: multer.memoryStorage() })

app.post('/api/leads/import', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

    try {
        const fileContent = req.file.buffer.toString('utf-8')
        const records = parse(fileContent, {
            columns: true,
            skip_empty_lines: true,
            relax_quotes: true
        })

        if (records.length === 0) return res.json({ success: true, count: 0 })

        // Map CSV fields to DB fields
        const leads = records.map(r => ({
            company_name: r['Company'] || r['Company Name for Emails'] || r['Organization'] || '',
            person_name: `${r['First Name'] || ''} ${r['Last Name'] || ''}`.trim(),
            email: r['Email'] || r['Email Address'] || '',
            title: r['Title'] || r['Job Title'] || '',
            linkedin_url: r['Person Linkedin Url'] || r['Linkedin Url'] || '',
            custom_data: {
                company_website: r['Website'] || r['Company Website'] || '',
                imported_at: new Date().toISOString(),
                source_file: req.file.originalname
            },
            source: 'Import'
        })).filter(l => l.email || l.linkedin_url)

        await query('BEGIN')
        for (const lead of leads) {
            await query(
                `INSERT INTO leads(company_name, person_name, email, job_title, linkedin_url, status, custom_data, source, user_id)
                     VALUES($1, $2, $3, $4, $5, 'NEW', $6, $7, $8)
                     ON CONFLICT(email) DO NOTHING`,
                [
                    lead.company_name,
                    lead.person_name,
                    lead.email,
                    lead.title,
                    lead.linkedin_url,
                    JSON.stringify(lead.custom_data),
                    lead.source,
                    req.userId
                ]
            )
        }
        await query('COMMIT')

        res.json({ success: true, count: leads.length })
    } catch (err) {
        await query('ROLLBACK')
        console.error('Import failed:', err)
        res.status(500).json({ error: 'Failed to process CSV file' })
    }
})


// --- INTEGRATIONS (Aimfox / GoHighLevel) ---
import { aimfoxService } from './src/backend/services/aimfox.js'
import { ghlService } from './src/backend/services/gohighlevel.js'

// List Aimfox Campaigns
app.get('/api/integrations/aimfox/campaigns', requireAuth, async (req, res) => {
    try {
        const campaigns = await aimfoxService.listCampaigns()
        res.json({ campaigns })
    } catch (err) {
        console.error('Aimfox campaigns error:', err)
        res.status(500).json({ error: 'Failed to fetch Aimfox campaigns' })
    }
})

// List GoHighLevel Tags
app.get('/api/integrations/ghl/tags', requireAuth, async (req, res) => {
    try {
        const tags = await ghlService.listTags()
        res.json({ tags })
    } catch (err) {
        console.error('GHL tags error:', err)
        res.status(500).json({ error: 'Failed to fetch GoHighLevel tags' })
    }
})

// DEBUG: Test GHL Connection (Public)
// DEBUG: Test GHL Connection (Public)
app.get('/api/test-ghl', async (req, res) => {
    try {
        // Direct call to see headers and response
        const axios = (await import('axios')).default;
        const key = process.env.GHL_API_KEY;
        const locationId = process.env.GHL_LOCATION_ID || '5tJd1yCE13B3wwdy9qvl';

        console.log('Testing GHL with key length:', key?.length);

        const response = await axios.get(
            `https://services.leadconnectorhq.com/locations/${locationId}/tags`,
            {
                headers: {
                    'Authorization': `Bearer ${key?.trim()}`,
                    'Content-Type': 'application/json',
                    'Version': '2021-07-28'
                }
            }
        );

        res.json({
            success: true,
            tags: response.data.tags?.slice(0, 3),
            total: response.data.tags?.length,
            debug: {
                headers: response.config.headers['Authorization'] ? 'Bearer [HIDDEN]' : 'Missing',
                url: response.config.url
            }
        });
    } catch (err) {
        res.status(500).json({
            error: err.message,
            status: err.response?.status,
            data: err.response?.data,
            debug: {
                hasKey: !!process.env.GHL_API_KEY,
                locationId: process.env.GHL_LOCATION_ID
            }
        });
    }
});

// Create GoHighLevel Tag
app.post('/api/integrations/ghl/tags', requireAuth, async (req, res) => {
    const { name } = req.body

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Tag name is required' })
    }

    try {
        const tag = await ghlService.createTag(name.trim())
        res.json({ success: true, tag })
    } catch (err) {
        console.error('GHL create tag error:', err)
        res.status(500).json({ error: 'Failed to create GoHighLevel tag' })
    }
})

// Push Leads to Outreach Tool
app.post('/api/integrations/push', requireAuth, async (req, res) => {
    const { tool, campaignId, leadIds } = req.body

    if (!tool || !campaignId || !Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'Missing required fields' })
    }

    try {
        // 1. Fetch Leads from DB
        const { rows: leads } = await query('SELECT * FROM leads WHERE id = ANY($1)', [leadIds])

        if (leads.length === 0) {
            return res.status(404).json({ error: 'No matching leads found' })
        }

        // 2. Respond immediately to prevent timeouts
        res.json({
            success: true,
            status: 'queued',
            count: leads.length,
            message: `Started pushing ${leads.length} leads to ${tool} in the background.`
        })

            // 3. Process in Background
            ; (async () => {
                console.log(`[Outreach] Background push started for ${leads.length} leads to ${tool}`);
                const results = { success: [], failed: [] };

                for (const lead of leads) {
                    try {
                        if (tool === 'aimfox') {
                            await aimfoxService.addLeadToCampaign(campaignId, lead)
                        } else if (tool === 'gohighlevel') {
                            // campaignId is actually the tag name for GHL
                            await ghlService.createContact(lead, null, campaignId)
                        }

                        // Update leads status locally
                        await query("UPDATE leads SET outreach_status = 'pushed', updated_at = NOW() WHERE id = $1", [lead.id])
                        results.success.push(lead.id)

                    } catch (err) {
                        console.error(`Failed to push lead ${lead.id} to ${tool}:`, err.message)
                        results.failed.push({ id: lead.id, error: err.message })
                        // Optional: Update status to 'failed_push'
                        await query("UPDATE leads SET outreach_status = 'failed_push', updated_at = NOW() WHERE id = $1", [lead.id])
                    }
                }
                console.log(`[Outreach] Background push complete. Success: ${results.success.length}, Failed: ${results.failed.length}`);
            })().catch(err => console.error('[Outreach] Background processing fatal error:', err));

    } catch (err) {
        console.error('Push integration error:', err)
        // Only redundant if response already sent, but safe here as we wait for SELECT
        if (!res.headersSent) res.status(500).json({ error: 'Integration push failed' })
    }
})
// Start Server
initDB().then(async () => {
    // Schema Migrations
    try {
        await query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_status VARCHAR(50) DEFAULT 'pending';");
        console.log("✅ Schema migration: outreach_status column verified.");
    } catch (err) {
        console.error("Values migration warning:", err.message);
    }

    app.listen(port, () => {
        console.log(`Server running on port ${port}`)
        console.log("✅ SERVER.JS - LOG PERSISTENCE V2 & CLAUDE FIX ACTIVE");
    })
})
