
import dotenv from 'dotenv';
import { query } from './db/index.js';
import { startLinkedInPeopleSearch, checkApifyRun, getApifyResults } from './src/backend/services/apify.js';
import crypto from 'crypto';

dotenv.config();

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const USER_EMAIL = 'roelof@elvison.com';

async function searchLinkedIn() {
    try {
        console.log('🕵️‍♀️ Starting LinkedIn Recovery for Orphans...');

        // 1. Get User AND ICPs
        const userRes = await query(`SELECT id FROM users WHERE email = $1`, [USER_EMAIL]);
        const userId = userRes.rows[0].id;

        const icpsRes = await query(`SELECT id, name FROM icps WHERE user_id = $1`, [userId]);
        const icps = icpsRes.rows;

        // 2. identifying Orphans (Same logic as lenient search, but we check DB for existence first)
        // We do NOT select icp_id here because it doesn't exist in companies table
        const companiesRes = await query(`
            SELECT company_name, website 
            FROM companies 
            WHERE user_id = $1
            AND website IS NOT NULL AND website != ''
        `, [userId]);

        const orphans = [];

        for (const company of companiesRes.rows) {
            // Robust check: Does this company have leads?
            // Check 1: Linked leads
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

        console.log(`🔎 Found ${orphans.length} verified orphans needing LinkedIn search.`);

        // 3. Process orphans
        for (const company of orphans) {
            console.log(`\n🚀 Searching LinkedIn for: ${company.company_name} (${company.website})...`);

            // Match ICP
            const icpMatch = icps.find(icp =>
                company.company_name.toLowerCase().includes('asset management') ||
                company.company_name.toLowerCase().includes('capital') ||
                company.company_name.toLowerCase().includes('reit') ||
                company.company_name.toLowerCase().includes('fund')
            ) || icps[0];
            const icpId = icpMatch?.id || null;

            const searchTerms = `"${company.company_name}" (CEO OR President OR "Managing Director" OR Founder)`;

            const runId = await startLinkedInPeopleSearch(APIFY_TOKEN, [searchTerms], { limit: 5 }); // 5 leads per company

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
                console.log(`\n✅ Found ${results.length} results.`);

                // Save results
                let savedCount = 0;
                for (const lead of results) {
                    // Map LinkedIn scraper result to our schema
                    const personName = lead.fullName || lead.name || lead.title || 'Unknown';
                    // Note: LinkedIn scraper output varies. Assuming standard fields.
                    const jobTitle = lead.jobTitle || lead.occupation || lead.headline || 'Unknown';
                    const linkedInUrl = lead.profileUrl || lead.url || '';

                    if (!linkedInUrl) continue;

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
                                VALUES ($1, $2, $3, $4, $5, 'NEW', 'LinkedIn', $6, $7)
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

searchLinkedIn();
