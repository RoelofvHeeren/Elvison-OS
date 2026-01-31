import dotenv from 'dotenv';
import pg from 'pg';
import { CompanyProfiler } from './src/backend/services/company-profiler.js';
import { CircuitBreaker, ErrorAggregator } from './src/utils/circuit-breaker.js';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Config
const CONFIG = {
    batchSize: 5, // Smaller batch size for scraping due to cost/time
    delayBetweenBatches: 5000,
    maxLeads: 100 // Safety limit for single run
};

const PROGRESS = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0
};

async function batchEnrichFlagged() {
    console.log('🚀 Starting Batch Deep Enrichment for Flagged Leads\n');

    try {
        // 1. Get unique companies needing research
        // We group by company_name/website to avoid re-scraping same site multiple times
        const companiesRes = await pool.query(`
            SELECT DISTINCT ON (company_name) 
                company_name, 
                company_website, 
                icp_id,
                id as sample_lead_id
            FROM leads
            WHERE outreach_status = 'NEEDS_RESEARCH' 
            AND (company_profile IS NULL OR LENGTH(company_profile) < 100)
            ORDER BY company_name
            LIMIT $1
        `, [CONFIG.maxLeads]);

        PROGRESS.total = companiesRes.rows.length;
        console.log(`📊 Found ${PROGRESS.total} unique companies to enrich (from flagged leads)\n`);

        const batches = chunkArray(companiesRes.rows, CONFIG.batchSize);

        for (let i = 0; i < batches.length; i++) {
            console.log(`\n📦 Processing Batch ${i + 1}/${batches.length}`);
            await processBatch(batches[i]);

            if (i < batches.length - 1) {
                console.log(`⏳ Waiting ${CONFIG.delayBetweenBatches / 1000}s...`);
                await sleep(CONFIG.delayBetweenBatches);
            }
        }

        generateReport();

    } catch (error) {
        console.error('🔥 Fatal error:', error);
    } finally {
        await pool.end();
    }
}

async function processBatch(companies) {
    const errorAggregator = new ErrorAggregator();

    // Process in parallel (limit parallelism if needed, but 5 is okay)
    const promises = companies.map(async (company) => {
        try {
            await enrichCompany(company);
        } catch (error) {
            errorAggregator.add(error, { companyName: company.company_name });
            PROGRESS.failed++;
        }
        PROGRESS.processed++;
    });

    await Promise.all(promises);

    if (errorAggregator.hasErrors()) {
        console.warn(`   ⚠️ Batch errors: ${errorAggregator.errors.length}`);
        errorAggregator.errors.forEach(e => console.warn(`   - ${e.context.companyName}: ${e.message}`));
    }
}

async function enrichCompany(company) {
    if (!company.company_website) {
        console.log(`   ⏩ Skipping ${company.company_name} (Missing website)`);
        PROGRESS.skipped++;
        return;
    }

    // Get ICP Name
    let icpName = 'Real Estate Investor';
    if (company.icp_id) {
        const icpRes = await pool.query('SELECT name FROM icps WHERE id = $1', [company.icp_id]);
        if (icpRes.rows.length > 0) icpName = icpRes.rows[0].name;
    }

    try {
        console.log(`   🔄 Enriching: ${company.company_name} (${company.company_website})...`);
        const result = await CompanyProfiler.enrichByDomain(
            company.company_website,
            company.company_name,
            icpName
        );

        if (result.status === 'success') {
            console.log(`   ✅ Success: ${company.company_name} (${result.contentLength} chars)`);
            PROGRESS.successful++;
        } else {
            console.warn(`   ⚠️ Failed: ${company.company_name} - ${result.reason}`);
            PROGRESS.failed++;
        }

    } catch (err) {
        throw new Error(`Enrichment failed: ${err.message}`);
    }
}

function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateReport() {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('               📊 ENRICHMENT REPORT                  ');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Total Companies: ${PROGRESS.total}`);
    console.log(`✅ Successfully Enriched: ${PROGRESS.successful}`);
    console.log(`❌ Failed: ${PROGRESS.failed}`);
    console.log(`⏩ Skipped: ${PROGRESS.skipped}`);
    console.log('\nNOTE: Successful enrichment automatically updates ALL leads for that company.');
    console.log('Next Step: Run "regenerate_all_messages.js" again to generate messages for these leads.');
    console.log('\n═══════════════════════════════════════════════════════════\n');
}

batchEnrichFlagged();
