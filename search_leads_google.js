
import dotenv from 'dotenv';
import { query } from './db/index.js';
import { startGoogleSearch, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';
import crypto from 'crypto';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const USER_EMAIL = 'roelof@elvison.com';

async function searchGoogle() {
    try {
        console.log('🕵️‍♀️ Starting Google Search Recovery for Orphans...');

        // 1. Get User AND ICPs
        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        const icpsRes = await query(`SELECT id, name FROM icps WHERE user_id = $1`, [userId]);
        const icps = icpsRes.rows;

        // 2. Identify Orphans
        const companiesRes = await query(`
            SELECT company_name, website 
            FROM companies 
            WHERE user_id = $1
            AND website IS NOT NULL AND website != ''
        `, [userId]);

        const orphans = [];

        for (const company of companiesRes.rows) {
            // Robust check using lead links
            const linkedRes = await query(`
                SELECT COUNT(*) FROM leads l
                JOIN leads_link link ON l.id = link.lead_id
                WHERE link.parent_id = $1
                AND (l.company_name ILIKE $2 OR l.company_name ILIKE $3)
            `, [userId, company.company_name, `%${company.company_name}%`]);

            if (parseInt(linkedRes.rows[0].count) === 0) {
                // Double check specific known aliases
                if (company.website.includes('jpmorgan') && (await checkName(userId, 'J.P. Morgan'))) continue;
                if (company.website.includes('goldmansachs') && (await checkName(userId, 'Goldman Sachs'))) continue;
                if (company.website.includes('brookfield') && (await checkName(userId, 'Brookfield'))) continue;
                if (company.website.includes('bwalk') && (await checkName(userId, 'Boardwalk'))) continue;
                if (company.website.includes('clc-sic') && (await checkName(userId, 'Canada Lands'))) continue;
                if (company.website.includes('choicereit') && (await checkName(userId, 'Choice Properties'))) continue;
                if (company.website.includes('middlefield') && (await checkName(userId, 'MIDDLEFIELD'))) continue;
                if (company.website.includes('acremgt') && (await checkName(userId, 'ACRE'))) continue;

                orphans.push(company);
            }
        }

        console.log(`🔎 Found ${orphans.length} verified orphans needing Google search.`);

        // 3. Process orphans
        for (const company of orphans) {
            console.log(`\n🚀 Searching Google for: ${company.company_name} (${company.website})...`);

            // Match ICP
            const icpMatch = icps.find(icp =>
                company.company_name.toLowerCase().includes('asset management') ||
                company.company_name.toLowerCase().includes('capital') ||
                company.company_name.toLowerCase().includes('reit') ||
                company.company_name.toLowerCase().includes('fund')
            ) || icps[0];
            const icpId = icpMatch?.id || null;

            // Queries: Focus on LinkedIn profiles
            const searchQuery = `site:linkedin.com/in "${company.company_name}" (CEO OR President OR "Managing Director" OR Founder)`;

            const runId = await startGoogleSearch(APIFY_TOKEN, [searchQuery], { limit: 10 });

            if (!runId) {
                console.log('Skipping due to error starting run.');
                continue;
            }

            // Poll
            let status = 'RUNNING';
            let datasetId = null;
            while (status === 'RUNNING') {
                await new Promise(r => setTimeout(r, 5000));
                const check = await checkApifyRun(APIFY_TOKEN, runId);
                status = check.status;
                datasetId = check.datasetId;
                process.stdout.write(`\r⏳ ${status}...`);
            }

            if (status === 'SUCCEEDED' && datasetId) {
                const results = await getApifyResults(APIFY_TOKEN, datasetId);
                // Results structure from google-search-scraper:
                // { organicResults: [ { title: "Name - Title - Company | LinkedIn", url: "...", ... } ] }
                // Note: The structure might be a single object per result page, containing 'organicResults' array.
                // We need to flatten the results.

                let flatResults = [];
                results.forEach(page => {
                    if (page.organicResults) {
                        flatResults = flatResults.concat(page.organicResults);
                    }
                });

                console.log(`\n✅ Found ${flatResults.length} organic results.`);

                let savedCount = 0;
                for (const res of flatResults) {
                    const linkedInUrl = res.url;
                    if (!linkedInUrl || !linkedInUrl.includes('linkedin.com/in/')) continue;

                    // Parse Title for metadata
                    // Format usually: "Name - Valid Job Title - Company | LinkedIn"
                    // Example: "Shawn Lewis - CEO & Managing Director - Tricor Pacific Capital | LinkedIn"

                    const titleParts = res.title.split(' - ');
                    let personName = 'Unknown';
                    let jobTitle = 'Unknown';

                    if (titleParts.length >= 3) {
                        personName = titleParts[0].trim(); // Name
                        jobTitle = titleParts[1].trim();   // Job Title
                    } else if (titleParts.length === 2) {
                        // "Name - Title including company | LinkedIn"
                        personName = titleParts[0].trim();
                        jobTitle = titleParts[1].replace('| LinkedIn', '').trim();
                    } else {
                        // Fallback parsing
                        personName = res.title.split('|')[0].trim();
                    }

                    // Clean name (remove emojis etc if needed, though rare in Google title)
                    if (personName.includes('LinkedIn')) personName = personName.replace(' | LinkedIn', '').trim();

                    const leadId = crypto.randomUUID();
                    try {
                        const existing = await query(`SELECT id FROM leads WHERE linkedin_url = $1`, [linkedInUrl]);
                        let finalLeadId = leadId;

                        if (existing.rows.length === 0) {
                            await query(`
                                INSERT INTO leads (
                                    id, company_name, person_name, job_title, linkedin_url, 
                                    status, source, user_id, icp_id
                                )
                                VALUES ($1, $2, $3, $4, $5, 'NEW', 'Google', $6, $7)
                            `, [leadId, company.company_name, personName, jobTitle, linkedInUrl, userId, icpId]);
                        } else {
                            finalLeadId = existing.rows[0].id;
                        }

                        // Link
                        await query(`
                            INSERT INTO leads_link (lead_id, parent_id, parent_type)
                            VALUES ($1, $2, 'user')
                            ON CONFLICT (lead_id, parent_id, parent_type) DO NOTHING
                        `, [finalLeadId, userId]);

                        savedCount++;
                    } catch (err) {
                        console.error(`Error saving ${personName}:`, err.message);
                    }
                }
                console.log(`💾 Saved ${savedCount} leads.`);
            }
        }

        console.log('\n✨ All Done!');
        process.exit(0);

    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

async function checkName(userId, namePart) {
    const res = await query(`
        SELECT COUNT(*) FROM leads l
        JOIN leads_link link ON l.id = link.lead_id
        WHERE link.parent_id = $1
        AND l.company_name ILIKE $2
    `, [userId, `%${namePart}%`]);
    return parseInt(res.rows[0].count) > 0;
}

searchGoogle();
