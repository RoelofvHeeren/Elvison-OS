/**
 * FINAL VERIFICATION & FIX SCRIPT
 * 
 * 1. Deletes all leads with fit_score < 6 (Strict)
 * 2. Removes any remaining duplicates (keeping best profile)
 * 3. Checks profile length of survivors
 * 4. Retries enrichment for any short profiles
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function scrapeWebsite(url) {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        clearTimeout(timeout);
        if (!response.ok) return null;
        return (await response.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 25000);
    } catch (e) { return null; }
}

async function generateProfileText(companyName, domain, content) {
    const prompt = `
    Create a DEEP DIVE INVESTMENT MEMO for: ${companyName} (${domain}).
    WEBSITE CONTENT: ${content || "No content."}
    
    INSTRUCTIONS:
    - Write a HIGHLY DETAILED, PROFESSIONAL profile (20+ sentences).
    - Include: Executive Summary, Strategy, Deal History, Key People, Fit Analysis.
    - NO MARKDOWN FORMATTING. Just clear text.
    - End with "FIT_SCORE: X" (1-10) and "TYPE: InvestorType".
    `;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return null; }
}

async function main() {
    console.log('🛡️  FINAL SYSTEM VERIFICATION\n');

    try {
        // 1. DELETE LOW SCORES
        const delLow = await pool.query(`DELETE FROM leads WHERE (custom_data->>'fit_score')::int < 6`);
        console.log(`🗑️  Deleted ${delLow.rowCount} companies with score < 6.`);

        // 2. DEDUPLICATE (Safety check)
        const dups = await pool.query(`
            SELECT company_name, count(*) FROM leads 
            WHERE status != 'DISQUALIFIED' 
            GROUP BY company_name HAVING count(*) > 1
        `);

        if (dups.rows.length > 0) {
            console.log(`⚠️  Found ${dups.rows.length} duplicate groups. cleaning...`);
            for (const d of dups.rows) {
                const recs = await pool.query(`SELECT id, custom_data FROM leads WHERE company_name = $1`, [d.company_name]);
                const sorted = recs.rows.sort((a, b) => (b.custom_data?.company_profile?.length || 0) - (a.custom_data?.company_profile?.length || 0));
                const toDel = sorted.slice(1).map(r => r.id);
                await pool.query(`DELETE FROM leads WHERE id = ANY($1)`, [toDel]);
                console.log(`   - Deduped ${d.company_name}`);
            }
        } else {
            console.log(`✅  No duplicates found.`);
        }

        // 3. VERIFY PROFILES & FIX SHORT ONES
        const allCompanies = await pool.query(`
            SELECT id, company_name, custom_data 
            FROM leads 
            WHERE status != 'DISQUALIFIED'
            ORDER BY company_name
        `);

        console.log(`\n📊 Verifying ${allCompanies.rows.length} Final Companies...`);
        let shortProfiles = 0;

        for (const company of allCompanies.rows) {
            const profile = company.custom_data.company_profile || '';
            const scores = company.custom_data.fit_score;

            if (profile.length < 1000) {
                console.log(`   🔸 Short Profile: ${company.company_name} (${profile.length} chars) - FIXING...`);
                shortProfiles++;

                const url = company.custom_data.company_website || (company.custom_data.company_domain ? `https://${company.custom_data.company_domain}` : null);
                if (url) {
                    const content = await scrapeWebsite(url);
                    const newProfileRaw = await generateProfileText(company.company_name, company.custom_data.company_domain, content);

                    if (newProfileRaw && newProfileRaw.length > 500) {
                        const cleanProfile = newProfileRaw.replace(/FIT_SCORE:.*$/i, '').replace(/TYPE:.*$/i, '').trim();
                        company.custom_data.company_profile = cleanProfile;
                        company.custom_data.deep_dive_at = new Date().toISOString();

                        await pool.query(`UPDATE leads SET custom_data = $1 WHERE id = $2`, [company.custom_data, company.id]);
                        console.log(`      ✅ Fixed! New len: ${cleanProfile.length}`);
                    } else {
                        console.log(`      ❌ Failed to generate from content`);
                    }
                } else {
                    console.log(`      ❌ No URL - DELETING GHOST RECORD`);
                    await pool.query(`DELETE FROM leads WHERE id = $1`, [company.id]);
                    console.log(`      🗑️ Deleted ${company.company_name}`);
                }
            }
        }

        console.log(`\n✨ VERIFICATION COMPLETE.`);
        console.log(`   Total Companies: ${allCompanies.rows.length}`);
        console.log(`   Fixed Profiles: ${shortProfiles}`);

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

main();
