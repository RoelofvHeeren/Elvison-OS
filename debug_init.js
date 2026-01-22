
import pg from 'pg';
import { getExcludedCompanyNames, getExcludedDomains } from './src/backend/company-tracker.js';
import { initializeSearchTermsIfEmpty, getTermStrings } from './src/backend/services/search-term-manager.js';

const { Pool } = pg;

// Mock DB just for connection string
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Mock user and ICP IDs (you might need real ones to test fully, but let's try with dummy first or query one)
async function testInitialization() {
    try {
        const userRes = await pool.query('SELECT id FROM users LIMIT 1');
        if (userRes.rows.length === 0) throw new Error("No user found");
        const userId = userRes.rows[0].id;
        console.log(`Testing with User ID: ${userId}`);

        const icpRes = await pool.query('SELECT id FROM icps WHERE user_id = $1 LIMIT 1', [userId]);
        const icpId = icpRes.rows.length > 0 ? icpRes.rows[0].id : null;
        console.log(`Testing with ICP ID: ${icpId}`);

        console.time('ExcludedCompanies');
        await getExcludedCompanyNames(userId);
        console.timeEnd('ExcludedCompanies');

        console.time('ExcludedDomains');
        await getExcludedDomains(userId);
        console.timeEnd('ExcludedDomains');

        if (icpId) {
            console.time('InitSearchTerms');
            await initializeSearchTermsIfEmpty(icpId);
            console.timeEnd('InitSearchTerms');

            console.time('GetTerms');
            await getTermStrings(icpId);
            console.timeEnd('GetTerms');
        }

    } catch (e) {
        console.error("Test failed:", e);
    } finally {
        await pool.end();
    }
}

testInitialization();
