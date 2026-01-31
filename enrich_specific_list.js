import dotenv from 'dotenv';
import pg from 'pg';
import { CompanyProfiler } from './src/backend/services/company-profiler.js';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const TARGET_DOMAINS = [
    'alpinestartdev.com', 'aresmgmt.com', 'avenuelivingam.com', 'harrisonst.com',
    'juliusbaer.com', 'lankin.com', 'mackenzieinvestments.com', 'marubeni.com',
    'nicolawealth.com', 'obsiido.com', 'ourfamilyoffice.ca', 'pathstone.com',
    'pgim.com', 'powercorporation.com', 'raymondjames.com', 'rbcgam.com',
    'redevco.com', 'wellington.com'
];

async function enrichSpecificList() {
    console.log(`🚀 Starting Targeted Enrichment for ${TARGET_DOMAINS.length} High-Security Domains\n`);

    let successCount = 0;

    for (const domain of TARGET_DOMAINS) {
        try {
            // Find company name first for logging/logic
            const rows = await pool.query(
                `SELECT DISTINCT company_name FROM leads WHERE company_website ILIKE $1 OR custom_data::text ILIKE $1 LIMIT 1`,
                [`%${domain}%`]
            );

            const companyName = rows.rows[0]?.company_name || domain;
            console.log(`\n🎯 Processing: ${companyName} (${domain})...`);

            const result = await CompanyProfiler.enrichByDomain(domain, companyName, 'High Value Target');

            if (result.status === 'success') {
                console.log(`   ✅ Success (${result.pageCount === 'cloud-crawl' ? 'Cloud' : 'Local'}): ${result.contentLength} chars`);
                successCount++;
            } else {
                console.warn(`   ⚠️ Failed: ${result.reason}`);
            }

            // Wait a bit to be nice to APIs
            await new Promise(r => setTimeout(r, 2000));

        } catch (e) {
            console.error(`   ❌ Error processing ${domain}:`, e.message);
        }
    }

    console.log(`\n═══════════════════════════════════════════════════════════`);
    console.log(`🏁 Targeted Run Complete`);
    console.log(`✅ Success: ${successCount}/${TARGET_DOMAINS.length}`);
    console.log(`═══════════════════════════════════════════════════════════\n`);

    await pool.end();
}

enrichSpecificList();
