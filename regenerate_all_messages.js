import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import { OutreachService } from './src/backend/services/outreach-service.js';
import { CircuitBreaker, ErrorAggregator } from './src/utils/circuit-breaker.js';

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL,
    ssl: { rejectUnauthorized: false }
});

// Configuration
const CONFIG = {
    batchSize: 50,
    qualityThreshold: 80, // Skip regeneration if existing score >= 80
    dryRun: process.argv.includes('--dry-run'),
    maxRetries: 3,
    delayBetweenBatches: 2000, // 2s
};

// Circuit breakers for external services
const geminiBreaker = new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 60000,
    monitoringPeriod: 60000
});

// Progress tracking
const PROGRESS = {
    total: 0,
    processed: 0,
    regenerated: 0,
    preserved: 0,
    failed: 0,
    flaggedForEnrichment: 0,
    startTime: Date.now()
};

/**
 * Main regeneration function
 */
async function regenerateAllMessages() {
    console.log('🚀 Starting Message Regeneration to 100% Coverage\n');
    console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN (no database writes)' : 'LIVE'}`);
    console.log(`Batch Size: ${CONFIG.batchSize}`);
    console.log(`Quality Threshold: ${CONFIG.qualityThreshold}\n`);

    try {
        // 1. Get all leads that need processing
        const leadsQuery = await pool.query(`
            SELECT 
                id, 
                company_name, 
                person_name, 
                email,
                company_profile,
                company_website,
                icp_id,
                connection_request,
                email_message,
                email_subject,
                research_fact,
                research_fact_type,
                outreach_status,
                status
            FROM leads
            WHERE status != 'DISQUALIFIED'
            ORDER BY created_at DESC
        `);

        PROGRESS.total = leadsQuery.rows.length;
        console.log(`📊 Found ${PROGRESS.total} leads to process\n`);

        // 2. Process in batches
        const batches = chunkArray(leadsQuery.rows, CONFIG.batchSize);

        for (let i = 0; i < batches.length; i++) {
            console.log(`\n📦 Processing Batch ${i + 1}/${batches.length}`);
            await processBatch(batches[i], i);

            // Delay between batches to avoid rate limits
            if (i < batches.length - 1) {
                await sleep(CONFIG.delayBetweenBatches);
            }
        }

        // 3. Generate final report
        await generateReport();

    } catch (error) {
        console.error('🔥 Fatal error:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

/**
 * Process a single batch of leads
 */
async function processBatch(leads, batchIndex) {
    const errorAggregator = new ErrorAggregator();

    for (const lead of leads) {
        try {
            await processLead(lead);
        } catch (error) {
            errorAggregator.add(error, {
                leadId: lead.id,
                companyName: lead.company_name,
                personName: lead.person_name
            });
            PROGRESS.failed++;
        }

        PROGRESS.processed++;

        // Progress indicator every 10 leads
        if (PROGRESS.processed % 10 === 0) {
            const percent = ((PROGRESS.processed / PROGRESS.total) * 100).toFixed(1);
            console.log(`   Progress: ${PROGRESS.processed}/${PROGRESS.total} (${percent}%)`);
        }
    }

    // Log batch errors if any
    if (errorAggregator.hasErrors()) {
        console.warn(`\n⚠️  Batch ${batchIndex + 1} completed with ${errorAggregator.errors.length} errors:`);
        errorAggregator.errors.slice(0, 5).forEach(e => {
            console.warn(`   - ${e.context.personName} @ ${e.context.companyName}: ${e.message}`);
        });
    }
}

/**
 * Process a single lead
 */
async function processLead(lead) {
    // Step 1: Check if we should regenerate
    const shouldRegenerate = decideShouldRegenerate(lead);

    if (!shouldRegenerate) {
        PROGRESS.preserved++;
        return;
    }

    // Step 2: Check if profile is sufficient
    if (!lead.company_profile || lead.company_profile.length < 200) {
        await flagForDeepEnrichment(lead);
        PROGRESS.flaggedForEnrichment++;
        return;
    }

    // Step 3: Generate new message with circuit breaker
    const result = await geminiBreaker.execute(
        async () => {
            return await OutreachService.createLeadMessages({
                company_name: lead.company_name,
                company_profile: lead.company_profile,
                website: lead.company_website,
                person_name: lead.person_name,
                icp_type: await getIcpType(lead.icp_id)
            });
        },
        // Fallback: flag for manual review
        () => ({
            outreach_status: 'NEEDS_RESEARCH',
            outreach_reason: 'Circuit breaker open - API unavailable'
        })
    );

    // Step 4: Update database
    if (!CONFIG.dryRun && result.outreach_status === 'SUCCESS') {
        await pool.query(`
            UPDATE leads
            SET 
                connection_request = $1,
                email_message = $2,
                email_subject = $3,
                research_fact = $4,
                research_fact_type = $5,
                outreach_status = $6,
                status = 'NEW',
                updated_at = NOW()
            WHERE id = $7
        `, [
            result.linkedin_message,
            result.email_body,
            result.email_subject,
            result.research_fact,
            result.research_fact_type,
            result.outreach_status,
            lead.id
        ]);

        PROGRESS.regenerated++;
    } else if (!CONFIG.dryRun) {
        // Flag for manual review
        await pool.query(`
            UPDATE leads
            SET 
                status = 'MANUAL_REVIEW',
                outreach_status = $1,
                outreach_reason = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [result.outreach_status, result.outreach_reason, lead.id]);

        PROGRESS.flaggedForEnrichment++;
    }
}

/**
 * Decide if a lead should be regenerated
 */
function decideShouldRegenerate(lead) {
    // Missing messages
    if (!lead.connection_request || !lead.email_message) {
        return true;
    }

    // Low quality (simple heuristic - can be enhanced with actual scoring)
    const hasResearchFact = lead.research_fact && lead.research_fact.length > 20;
    const hasGoodLength = lead.connection_request.length > 100 && lead.connection_request.length < 300;
    const qualityScore = (hasResearchFact ? 50 : 0) + (hasGoodLength ? 30 : 0) + 20;

    if (qualityScore < CONFIG.qualityThreshold) {
        return true;
    }

    return false;
}

/**
 * Flag a lead for deep enrichment
 */
async function flagForDeepEnrichment(lead) {
    if (CONFIG.dryRun) return;

    await pool.query(`
        UPDATE leads
        SET 
            status = 'MANUAL_REVIEW',
            outreach_status = 'NEEDS_RESEARCH',
            outreach_reason = 'Insufficient company profile - needs deep enrichment',
            updated_at = NOW()
        WHERE id = $1
    `, [lead.id]);
}

/**
 * Get ICP type for a lead
 */
async function getIcpType(icpId) {
    if (!icpId) return 'Real Estate Investor';

    const result = await pool.query('SELECT name FROM icps WHERE id = $1', [icpId]);
    return result.rows[0]?.name || 'Real Estate Investor';
}

/**
 * Generate final report
 */
async function generateReport() {
    const duration = ((Date.now() - PROGRESS.startTime) / 1000).toFixed(1);
    const successRate = ((PROGRESS.regenerated / PROGRESS.total) * 100).toFixed(1);

    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('                  📊 REGENERATION REPORT                  ');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(`Total Leads Processed: ${PROGRESS.total}`);
    console.log(`✅ Successfully Regenerated: ${PROGRESS.regenerated}`);
    console.log(`💎 Preserved (High Quality): ${PROGRESS.preserved}`);
    console.log(`🔍 Flagged for Enrichment: ${PROGRESS.flaggedForEnrichment}`);
    console.log(`❌ Failed: ${PROGRESS.failed}`);
    console.log(`\nSuccess Rate: ${successRate}%`);
    console.log(`Duration: ${duration}s`);
    console.log(`\nCircuit Breaker Status:`);
    console.log(`   Gemini: ${JSON.stringify(geminiBreaker.getState(), null, 2)}`);

    if (CONFIG.dryRun) {
        console.log('\n⚠️  DRY RUN MODE - No changes were written to database');
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');

    // Write detailed log
    const logData = {
        timestamp: new Date().toISOString(),
        config: CONFIG,
        progress: PROGRESS,
        circuitBreakers: {
            gemini: geminiBreaker.getState()
        }
    };

    fs.writeFileSync(
        'regeneration_log.json',
        JSON.stringify(logData, null, 2)
    );
    console.log('📝 Detailed log written to regeneration_log.json\n');
}

/**
 * Utility: Chunk array into batches
 */
function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Utility: Sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run
regenerateAllMessages().catch(console.error);
