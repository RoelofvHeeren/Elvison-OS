import pg from 'pg';
import dotenv from 'dotenv';
import { saveLeadsToDB } from './src/backend/workflow.js';
import { query, pool } from './db/index.js';

dotenv.config();

// Mock console.log to avoid noise or capture output
const originalLog = console.log;
const logStep = (step, msg) => {
    originalLog(`[${step}] ${msg}`);
};

async function verifyIntegration() {
    originalLog('🚀 Verifying Link Table Integration...\n');
    let client;
    const testEmail = `test_verification_${Date.now()}@example.com`;
    let testUserId = null;

    try {
        // 1. Get a valid user ID (grab first one)
        const userRes = await query('SELECT id FROM users LIMIT 1');
        if (userRes.rows.length === 0) {
            throw new Error('No users found in DB to test with.');
        }
        testUserId = userRes.rows[0].id;
        originalLog(`👤 Testing with User ID: ${testUserId}`);

        // 2. Create a test lead object
        const testLead = {
            company_name: 'Verification Test Co',
            first_name: 'Verif',
            last_name: 'ication',
            email: testEmail,
            title: 'Tester',
            linkedin_url: 'https://linkedin.com/in/test-verification',
            company_profile: 'A test company for verification.',
            company_website: 'test.com',
            match_score: 10,
            company_fit_score: 10
        };

        // 3. Call saveLeadsToDB (Function under test)
        originalLog('💾 Calling saveLeadsToDB...');
        await saveLeadsToDB([testLead], testUserId, null, logStep, 'NEW', null);

        // 4. Verify Database State
        originalLog('🔍 Verifying Database Records...');

        // Check Lead
        const leadRes = await query('SELECT id, status FROM leads WHERE email = $1', [testEmail]);
        if (leadRes.rows.length === 0) throw new Error('Lead was NOT found in `leads` table!');
        const leadId = leadRes.rows[0].id;
        originalLog(`   ✅ Lead created with ID: ${leadId}`);

        // Check Link Table
        const linkRes = await query(`
            SELECT * FROM leads_link_table 
            WHERE lead_id = $1 AND parent_id = $2 AND parent_type = 'user'
        `, [leadId, testUserId]);

        if (linkRes.rows.length === 0) {
            throw new Error('❌ Link table entry MISSING for the new lead!');
        }
        originalLog('   ✅ Link table entry confirmed!');

        // 5. Cleanup
        originalLog('🧹 Cleaning up test data...');
        await query('DELETE FROM leads WHERE id = $1', [leadId]);
        originalLog('   ✅ Test data deleted.');

        originalLog('\n✅ Verification Logic PASSED!');

    } catch (error) {
        console.error('❌ Verification FAILED:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

verifyIntegration();
