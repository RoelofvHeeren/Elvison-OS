
import dotenv from 'dotenv';
dotenv.config();
import { runAgentWorkflow } from './src/backend/workflow.js';
import { query } from './db/index.js';

async function testBatching() {
    console.log('🧪 Starting Workflow Batching Test...');

    const runId = crypto.randomUUID();
    const userId = '550e8400-e29b-41d4-a716-446655440000'; // Dummy User

    const logs = [];
    const logStep = (step, msg) => {
        const timestamp = new Date().toISOString();
        const log = `[${timestamp}] [${step}] ${msg}`;
        logs.push(log);
        console.log(log);
    };

    // Use a targetLeads slightly larger than minBatchSize (5) to trigger one batch + remainders
    const TARGET_LEADS = 7;

    // Mock inputs to find companies
    const mockInput = {
        goal: "Find high-quality residential developers in Canada",
        icpDescription: "Residential real estate developers in Canada focusing on multi-family housing.",
        keyAttributes: "Track record of success, residential focus.",
        redFlags: "Commercial only, industrial only.",
        baselineTitles: ["President", "CEO", "Principal", "VP Development"],
        targetLeads: TARGET_LEADS,
        input_as_text: "Find 7 residential developers in Canada."
    };

    try {
        // Prepare DB (Optional: ensure user exists if strict FK constraints)
        // Assuming user exists or constraints are loose for test.

        console.log(`🚀 Running workflow targetLeads=${TARGET_LEADS}...`);
        const result = await runAgentWorkflow(mockInput, {
            userId,
            icpId: null, // Legacy run
            filters: { geography: ['Canada'] }, // filters is a top-level config key, not nested in userParams based on view_file
            runId,
            listeners: { onLog: ({ step, detail }) => logStep(step, detail) },
            checkCancellation: async () => false,
            targetLeads: TARGET_LEADS,
            minBatchSize: 2 // Override to test small batches
        });

        console.log('✅ Workflow finished!');
        console.log('Status:', result.status);
        console.log('Leads:', result.leads.length);

        // Verify Logs for "Batch Buffer full"
        const hasBatchLog = logs.some(l => l.includes('Batch buffer full'));
        const hasIncrementalSaveLog = logs.some(l => l.includes('Incremental save')); // From scraper or batch flush?

        if (hasBatchLog) {
            console.log('✅ TEST PASSED: Batching logic triggered.');
        } else {
            console.error('❌ TEST FAILED: Batching logic NOT triggered (Did not see "Batch buffer full" log).');
        }

        // Verify DB
        const dbResult = await query('SELECT count(*) FROM leads WHERE run_id = $1', [runId]);
        console.log(`✅ DB Verification: Found ${dbResult.rows[0].count} leads in DB for run ${runId}`);

    } catch (e) {
        console.error('❌ Test failed with error:', e);
    } finally {
        // Clean up test data?
        // await query('DELETE FROM leads WHERE run_id = $1', [runId]);
        process.exit(0);
    }
}

testBatching();
