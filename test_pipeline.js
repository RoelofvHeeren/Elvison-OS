/**
 * Integration Test: Pipeline V2 — Save-Then-Enrich
 * 
 * Tests:
 * 1. saveLead() inserts a lead with NO outreach (status = SCRAPED)
 * 2. A second saveLead() with null outreach does NOT overwrite (COALESCE works)
 * 3. enrichLeadOutreach() updates ONLY outreach fields (status → NEW)
 * 4. A third saveLead() with null outreach still preserves the enriched data
 * 
 * Run: node test_pipeline.js
 */

import { saveLead, saveLeadsBatch, enrichLeadOutreach } from './src/backend/pipeline/persist.js';
import { query } from './db/index.js';

const TEST_EMAIL = `pipeline-test-${Date.now()}@test-pipeline.com`;

async function runTest() {
    console.log('=== Pipeline V2 Integration Test ===\n');

    // Get a test userId
    const userRes = await query(`SELECT id FROM users LIMIT 1`);
    if (userRes.rows.length === 0) {
        console.error('❌ No users found in DB. Cannot run test.');
        process.exit(1);
    }
    const userId = userRes.rows[0].id;

    try {
        // --- TEST 1: Save lead WITHOUT outreach ---
        console.log('TEST 1: Save lead without outreach (SCRAPED status)');
        const result1 = await saveLead({
            first_name: 'Test',
            last_name: 'Pipeline',
            email: TEST_EMAIL,
            title: 'VP Engineering',
            company_name: 'Test Corp',
            company_domain: 'testcorp.com',
            company_profile: 'A great test company for residential development.',
            match_score: 8,
            linkedin_url: 'https://linkedin.com/in/testpipeline'
        }, userId, null, 'SCRAPED', null);

        console.log(`   Result: ${result1.action} (id: ${result1.id})`);

        // Verify in DB
        const check1 = await query(`SELECT status, connection_request, email_message FROM leads WHERE email = $1`, [TEST_EMAIL]);
        console.log(`   DB Status: ${check1.rows[0].status}`);
        console.log(`   DB connection_request: ${check1.rows[0].connection_request}`);
        console.log(`   DB email_message: ${check1.rows[0].email_message}`);

        const pass1 = check1.rows[0].status === 'SCRAPED' && check1.rows[0].connection_request === null;
        console.log(`   ${pass1 ? '✅ PASS' : '❌ FAIL'}: Lead saved with SCRAPED status, no outreach\n`);

        // --- TEST 2: Save again with null outreach (COALESCE test) ---
        console.log('TEST 2: Re-save lead with null outreach (should NOT overwrite)');
        const result2 = await saveLead({
            first_name: 'Test',
            last_name: 'Pipeline',
            email: TEST_EMAIL,
            title: 'VP Engineering',
            company_name: 'Test Corp',
            connection_request: null,  // Explicitly null
            email_message: null        // Explicitly null
        }, userId, null, 'SCRAPED', null);

        console.log(`   Result: ${result2.action}`);

        const check2 = await query(`SELECT status, connection_request, company_profile FROM leads WHERE email = $1`, [TEST_EMAIL]);
        console.log(`   DB Status: ${check2.rows[0].status}`);
        console.log(`   DB company_profile preserved: ${check2.rows[0].company_profile ? 'YES' : 'NO'}`);

        const pass2 = check2.rows[0].company_profile !== null;
        console.log(`   ${pass2 ? '✅ PASS' : '❌ FAIL'}: COALESCE preserved existing company_profile\n`);

        // --- TEST 3: Enrich with outreach (save-then-enrich) ---
        console.log('TEST 3: Enrich lead with outreach data (UPDATE only)');
        const enrichResult = await enrichLeadOutreach(TEST_EMAIL, {
            connection_request: 'Hi Test, noticed your work on residential projects. Would love to connect.',
            email_message: 'Dear Test, reaching out regarding partnership opportunities...',
            email_subject: 'Partnership Opportunity | Residential',
            email_body: 'Dear Test, reaching out regarding partnership opportunities...'
        }, 'NEW');

        console.log(`   Result: ${enrichResult.success ? 'SUCCESS' : 'FAILED'} (${enrichResult.reason || 'ok'})`);

        const check3 = await query(`SELECT status, connection_request, email_message, company_profile FROM leads WHERE email = $1`, [TEST_EMAIL]);
        console.log(`   DB Status: ${check3.rows[0].status}`);
        console.log(`   DB connection_request: "${(check3.rows[0].connection_request || '').substring(0, 60)}..."`);
        console.log(`   DB email_message: "${(check3.rows[0].email_message || '').substring(0, 60)}..."`);
        console.log(`   DB company_profile still present: ${check3.rows[0].company_profile ? 'YES' : 'NO'}`);

        const pass3 = check3.rows[0].status === 'NEW' &&
            check3.rows[0].connection_request !== null &&
            check3.rows[0].email_message !== null &&
            check3.rows[0].company_profile !== null;
        console.log(`   ${pass3 ? '✅ PASS' : '❌ FAIL'}: Outreach enriched, status upgraded to NEW, profile preserved\n`);

        // --- TEST 4: Re-save with null outreach AFTER enrichment ---
        console.log('TEST 4: Re-save lead with null outreach AFTER enrichment (COALESCE must protect)');
        const result4 = await saveLead({
            first_name: 'Test',
            last_name: 'Pipeline',
            email: TEST_EMAIL,
            title: 'VP Engineering',
            company_name: 'Test Corp',
            connection_request: null,  // Would overwrite without COALESCE
            email_message: null        // Would overwrite without COALESCE
        }, userId, null, 'SCRAPED', null);

        console.log(`   Result: ${result4.action}`);

        const check4 = await query(`SELECT status, connection_request, email_message FROM leads WHERE email = $1`, [TEST_EMAIL]);
        console.log(`   DB Status: ${check4.rows[0].status} (should still be NEW or at least not overwritten)`);
        console.log(`   DB connection_request preserved: ${check4.rows[0].connection_request ? 'YES' : 'NO'}`);
        console.log(`   DB email_message preserved: ${check4.rows[0].email_message ? 'YES' : 'NO'}`);

        const pass4 = check4.rows[0].connection_request !== null && check4.rows[0].email_message !== null;
        console.log(`   ${pass4 ? '✅ PASS' : '❌ FAIL'}: COALESCE protected outreach from being overwritten\n`);

        // --- SUMMARY ---
        const allPass = pass1 && pass2 && pass3 && pass4;
        console.log('=== RESULTS ===');
        console.log(`Test 1 (Save without outreach):     ${pass1 ? '✅' : '❌'}`);
        console.log(`Test 2 (COALESCE protects data):     ${pass2 ? '✅' : '❌'}`);
        console.log(`Test 3 (Enrich with outreach):       ${pass3 ? '✅' : '❌'}`);
        console.log(`Test 4 (COALESCE after enrichment):  ${pass4 ? '✅' : '❌'}`);
        console.log(`\nOverall: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

    } finally {
        // Cleanup test data
        console.log(`\nCleaning up test lead (${TEST_EMAIL})...`);
        await query(`DELETE FROM leads_link WHERE lead_id IN (SELECT id FROM leads WHERE email = $1)`, [TEST_EMAIL]);
        await query(`DELETE FROM leads WHERE email = $1`, [TEST_EMAIL]);
        console.log('Done.');
        process.exit(0);
    }
}

runTest().catch(e => {
    console.error('Test crashed:', e);
    process.exit(1);
});
